import { checkBatch, emptyBatchResult, encodeSegment, identifierBody, pick, requireItemId } from "../core.js";
import type { RequestOptions, Transport } from "../core.js";
import type {
  BatchResult,
  IdentifierAddParams,
  Person,
  PersonBatchItem,
  PersonIdentifiers,
  PersonUpsertParams,
  PersonUpsertResult,
} from "../types.js";

const PERSON_FIELDS = {
  name: "name",
  email: "email",
  phone: "phone",
  role: "role",
  access: "access",
  isPrimary: "is_primary",
  extraEmails: "extra_emails",
  extraPhones: "extra_phones",
  customFields: "custom_fields",
  clear: "clear",
};

const customerPeoplePath = (customerExternalId: string) =>
  `/customers/${encodeSegment(customerExternalId, "customerExternalId")}/people`;
const personPath = (personExternalId: string) => `/people/${encodeSegment(personExternalId, "personExternalId")}`;

/** Identificadores extras de uma pessoa — `bf.people.identifiers`. */
export class PeopleIdentifiers {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /**
   * Todos os identificadores da pessoa: o principal (`external_id` do retorno) e os extras.
   * Aceita no caminho o principal OU qualquer um dos extras. Escopo `customers:read`.
   *
   * É a fonte de verdade para **reconciliar**: `people.list` mostra só o identificador
   * principal, então um id que virou extra some de lá sem ter sumido do cadastro — e, sem
   * esta leitura, era preciso ESCREVER (tentar um `add`) para descobrir o que aconteceu.
   * `GET /people/{person_external_id}/identifiers`
   */
  list(personExternalId: string, options?: RequestOptions): Promise<PersonIdentifiers> {
    return this.#t.data({ method: "GET", path: `${personPath(personExternalId)}/identifiers` }, options);
  }

  /**
   * Liga o id de outro sistema seu (`extraId`) à mesma pessoa. Idempotente. Se o id já é de
   * OUTRO cadastro, a API responde 409 `IDENTIFIER_IN_USE` (`ConflictError`).
   * `PUT /people/{person_external_id}/identifiers/{extra_id}`
   */
  add(
    personExternalId: string,
    extraId: string,
    params: IdentifierAddParams = {},
    options?: RequestOptions,
  ): Promise<PersonIdentifiers> {
    return this.#t.data(
      {
        method: "PUT",
        path: `${personPath(personExternalId)}/identifiers/${encodeSegment(extraId, "extraId")}`,
        body: identifierBody(params),
      },
      options,
    );
  }

  /** Desliga um identificador extra da pessoa. `DELETE /people/{person_external_id}/identifiers/{extra_id}` */
  remove(personExternalId: string, extraId: string, options?: RequestOptions): Promise<PersonIdentifiers> {
    return this.#t.data(
      {
        method: "DELETE",
        path: `${personPath(personExternalId)}/identifiers/${encodeSegment(extraId, "extraId")}`,
      },
      options,
    );
  }
}

/** Pessoas dos clientes (quem abre chamados pelo widget/portal) — `bf.people`. */
export class People {
  readonly #t: Transport;
  /** Identificadores extras (ids de outros sistemas seus) da pessoa. */
  readonly identifiers: PeopleIdentifiers;

  constructor(transport: Transport) {
    this.#t = transport;
    this.identifiers = new PeopleIdentifiers(transport);
  }

  /**
   * Cria ou atualiza uma pessoa do cliente pelo `external_id` dela no seu sistema (o mesmo
   * `user.externalId` assinado no widget — sem `:`). Só os campos informados mudam; `null`
   * explícito vai como `null`. Pelo e-mail (ou telefone) a API acha a pessoa que já chegou por
   * outro canal e a adota, sem duplicar; a mesma pessoa informada com outro cliente é transferida.
   * `status` diz o que aconteceu (`created`, `updated`, `unchanged`).
   *
   * `customFields`, quando enviada, SUBSTITUI a lista inteira de campos personalizados da
   * pessoa — campo que ficar de fora é removido. Omitir a propriedade não mexe em nada.
   *
   * `clear` APAGA contato (`["email"]`, `["phone"]` ou os dois). É explícito de propósito:
   * `null`, `[]` e omitir continuam sendo "não mexe". Campo fora da lista aceita é recusado
   * (422 `PERSON_CLEAR_FIELD_INVALID`), e por um identificador EXTRA a API recusa (409
   * `PERSON_CLEAR_NOT_OWN_RECORD`): só se limpa a própria ficha.
   * `PUT /customers/{customer_external_id}/people/{person_external_id}`
   */
  upsert(
    customerExternalId: string,
    personExternalId: string,
    params: PersonUpsertParams = {},
    options?: RequestOptions,
  ): Promise<PersonUpsertResult> {
    return this.#t.data(
      {
        method: "PUT",
        path: `${customerPeoplePath(customerExternalId)}/${encodeSegment(personExternalId, "personExternalId")}`,
        body: { person: pick(params, PERSON_FIELDS) },
      },
      options,
    );
  }

  /** Lista as pessoas do cliente (com e sem acesso). `GET /customers/{customer_external_id}/people` */
  list(customerExternalId: string, options?: RequestOptions): Promise<Person[]> {
    return this.#t.data({ method: "GET", path: customerPeoplePath(customerExternalId) }, options);
  }

  /**
   * Retira o acesso da pessoa (ela continua no histórico). Devolve a pessoa com `access: false`;
   * um `upsert` com `access: true` devolve o acesso.
   * `DELETE /customers/{customer_external_id}/people/{person_external_id}`
   */
  delete(customerExternalId: string, personExternalId: string, options?: RequestOptions): Promise<Person> {
    return this.#t.data(
      {
        method: "DELETE",
        path: `${customerPeoplePath(customerExternalId)}/${encodeSegment(personExternalId, "personExternalId")}`,
      },
      options,
    );
  }

  /**
   * Cria/atualiza até {@link BATCH_MAX} (500) pessoas numa requisição. Cada item leva
   * `customerExternalId`, `externalId` da pessoa e os campos de `upsert`. Acima de 500 itens lança
   * `TypeError` sem ir à rede — a SDK NÃO divide sozinha: divida em fatias de 500 (o `index` de
   * cada resultado é a posição no lote enviado). Um item com erro não desfaz os outros. Lista
   * vazia devolve o resultado zerado sem requisição.
   * `POST /people/batch`
   */
  async batch(items: readonly PersonBatchItem[], options?: RequestOptions): Promise<BatchResult> {
    checkBatch("people.batch", items);
    const body = items.map((item, i) => ({
      customer_external_id: requireItemId(item?.customerExternalId, `items[${i}].customerExternalId`),
      person: {
        external_id: requireItemId(item?.externalId, `items[${i}].externalId`),
        ...pick(item, PERSON_FIELDS),
      },
    }));
    if (body.length === 0) return emptyBatchResult();
    return this.#t.data({ method: "POST", path: "/people/batch", body: { items: body } }, options);
  }
}
