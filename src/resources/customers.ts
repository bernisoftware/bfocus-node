import { checkBatch, emptyBatchResult, encodeSegment, identifierBody, paginate, pick, requireItemId } from "../core.js";
import type { RequestOptions, Transport } from "../core.js";
import type {
  BatchResult,
  Contact,
  ContactUpsertParams,
  Customer,
  CustomerBatchItem,
  CustomerListAllParams,
  CustomerListParams,
  CustomerUpsertParams,
  CustomerWithIdentifiers,
  Deleted,
  IdentifierAddParams,
  Interaction,
  InteractionCreateParams,
  InteractionListAllParams,
  InteractionListParams,
  Page,
  ProductRef,
} from "../types.js";

const CUSTOMER_FIELDS = {
  name: "name",
  document: "document",
  email: "email",
  phone: "phone",
  website: "website",
  notes: "notes",
  customFields: "custom_fields",
};

const CONTACT_FIELDS = {
  name: "name",
  role: "role",
  email: "email",
  phone: "phone",
  notes: "notes",
  isPrimary: "is_primary",
};

const customerPath = (externalId: string) => `/customers/${encodeSegment(externalId, "externalId")}`;

/** Identificadores extras de um cliente — `bf.customers.identifiers`. */
export class CustomerIdentifiers {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /**
   * Liga o id de outro sistema seu (`extraId`) ao mesmo cliente. Idempotente. Se o id já é de
   * OUTRO cadastro, a API responde 409 `IDENTIFIER_IN_USE` (`ConflictError`).
   * `PUT /customers/{external_id}/identifiers/{extra_id}`
   */
  add(
    externalId: string,
    extraId: string,
    params: IdentifierAddParams = {},
    options?: RequestOptions,
  ): Promise<CustomerWithIdentifiers> {
    return this.#t.data(
      {
        method: "PUT",
        path: `${customerPath(externalId)}/identifiers/${encodeSegment(extraId, "extraId")}`,
        body: identifierBody(params),
      },
      options,
    );
  }

  /** Desliga um identificador extra do cliente. `DELETE /customers/{external_id}/identifiers/{extra_id}` */
  remove(externalId: string, extraId: string, options?: RequestOptions): Promise<CustomerWithIdentifiers> {
    return this.#t.data(
      {
        method: "DELETE",
        path: `${customerPath(externalId)}/identifiers/${encodeSegment(extraId, "extraId")}`,
      },
      options,
    );
  }
}

/** Contatos de um cliente — `bf.customers.contacts`. */
export class CustomerContacts {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Lista os contatos do cliente. `GET /customers/{external_id}/contacts` */
  list(externalId: string, options?: RequestOptions): Promise<Contact[]> {
    return this.#t.data({ method: "GET", path: `${customerPath(externalId)}/contacts` }, options);
  }

  /**
   * Cria ou atualiza um contato pelo `external_id` dele no seu sistema.
   * `PUT /customers/{external_id}/contacts/{contact_external_id}`
   */
  upsert(
    externalId: string,
    contactExternalId: string,
    params: ContactUpsertParams = {},
    options?: RequestOptions,
  ): Promise<Contact> {
    return this.#t.data(
      {
        method: "PUT",
        path: `${customerPath(externalId)}/contacts/${encodeSegment(contactExternalId, "contactExternalId")}`,
        body: pick(params, CONTACT_FIELDS),
      },
      options,
    );
  }

  /** Exclui um contato. `DELETE /customers/{external_id}/contacts/{contact_external_id}` */
  delete(externalId: string, contactExternalId: string, options?: RequestOptions): Promise<Deleted> {
    return this.#t.data(
      {
        method: "DELETE",
        path: `${customerPath(externalId)}/contacts/${encodeSegment(contactExternalId, "contactExternalId")}`,
      },
      options,
    );
  }
}

/** Produtos vinculados a um cliente — `bf.customers.products`. */
export class CustomerProducts {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Lista os produtos que o cliente usa. `GET /customers/{external_id}/products` */
  list(externalId: string, options?: RequestOptions): Promise<ProductRef[]> {
    return this.#t.data({ method: "GET", path: `${customerPath(externalId)}/products` }, options);
  }

  /** Vincula um produto ao cliente (idempotente). `PUT /customers/{external_id}/products/{slug}` */
  attach(externalId: string, productSlug: string, options?: RequestOptions): Promise<ProductRef> {
    return this.#t.data(
      {
        method: "PUT",
        path: `${customerPath(externalId)}/products/${encodeSegment(productSlug, "productSlug")}`,
      },
      options,
    );
  }

  /** Desvincula um produto do cliente. `DELETE /customers/{external_id}/products/{slug}` */
  detach(externalId: string, productSlug: string, options?: RequestOptions): Promise<Deleted> {
    return this.#t.data(
      {
        method: "DELETE",
        path: `${customerPath(externalId)}/products/${encodeSegment(productSlug, "productSlug")}`,
      },
      options,
    );
  }
}

/** Interações (linha do tempo) de um cliente — `bf.customers.interactions`. */
export class CustomerInteractions {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Lista as interações, mais recentes primeiro. `GET /customers/{external_id}/interactions` */
  list(externalId: string, params: InteractionListParams = {}, options?: RequestOptions): Promise<Page<Interaction>> {
    return this.#t.page(
      {
        method: "GET",
        path: `${customerPath(externalId)}/interactions`,
        query: { page: params.page, page_size: params.pageSize },
      },
      options,
    );
  }

  /** Percorre TODAS as interações do cliente, página a página. */
  listAll(
    externalId: string,
    params: InteractionListAllParams = {},
    options?: RequestOptions,
  ): AsyncIterableIterator<Interaction> {
    const pageSize = params.pageSize ?? 100;
    customerPath(externalId); // valida já, não só na primeira iteração
    return paginate((page) => this.list(externalId, { page, pageSize }, options));
  }

  /**
   * Registra uma interação (HTML ou texto puro, que vira parágrafos).
   * `POST /customers/{external_id}/interactions`
   */
  create(
    externalId: string,
    content: string,
    params: InteractionCreateParams = {},
    options?: RequestOptions,
  ): Promise<Interaction> {
    return this.#t.data(
      {
        method: "POST",
        path: `${customerPath(externalId)}/interactions`,
        body: { content, ...pick(params, { isInternal: "is_internal", authorEmail: "author_email" }) },
      },
      options,
    );
  }
}

/** Clientes — `bf.customers`. */
export class Customers {
  readonly #t: Transport;
  /** Contatos do cliente. */
  readonly contacts: CustomerContacts;
  /** Produtos vinculados ao cliente. */
  readonly products: CustomerProducts;
  /** Interações (linha do tempo) do cliente. */
  readonly interactions: CustomerInteractions;
  /** Identificadores extras (ids de outros sistemas seus) do cliente. */
  readonly identifiers: CustomerIdentifiers;

  constructor(transport: Transport) {
    this.#t = transport;
    this.contacts = new CustomerContacts(transport);
    this.products = new CustomerProducts(transport);
    this.interactions = new CustomerInteractions(transport);
    this.identifiers = new CustomerIdentifiers(transport);
  }

  /**
   * Cria ou atualiza um cliente pelo `external_id` do seu sistema. Só os campos informados
   * mudam; `null` explícito limpa o campo. `PUT /customers/{external_id}`
   */
  upsert(externalId: string, params: CustomerUpsertParams = {}, options?: RequestOptions): Promise<Customer> {
    return this.#t.data(
      { method: "PUT", path: customerPath(externalId), body: pick(params, CUSTOMER_FIELDS) },
      options,
    );
  }

  /**
   * Cria/atualiza até {@link BATCH_MAX} (500) clientes numa requisição. Cada item leva os mesmos
   * campos de `upsert` + `externalId`; só o que veio muda. Acima de 500 itens lança `TypeError`
   * sem ir à rede — a SDK NÃO divide sozinha: divida em fatias de 500 (o `index` de cada resultado
   * é a posição no lote enviado). Um item com erro não desfaz os outros (veja `results[i].status`
   * e `summary.error`). Lista vazia devolve o resultado zerado sem requisição.
   * `POST /customers/batch`
   */
  async batch(items: readonly CustomerBatchItem[], options?: RequestOptions): Promise<BatchResult> {
    checkBatch("customers.batch", items);
    const body = items.map((item, i) => ({
      external_id: requireItemId(item?.externalId, `items[${i}].externalId`),
      ...pick(item, CUSTOMER_FIELDS),
    }));
    if (body.length === 0) return emptyBatchResult();
    return this.#t.data({ method: "POST", path: "/customers/batch", body: { items: body } }, options);
  }

  /** Busca um cliente. `GET /customers/{external_id}` */
  get(externalId: string, options?: RequestOptions): Promise<Customer> {
    return this.#t.data({ method: "GET", path: customerPath(externalId) }, options);
  }

  /** Lista clientes (uma página). `GET /customers` */
  list(params: CustomerListParams = {}, options?: RequestOptions): Promise<Page<Customer>> {
    return this.#t.page(
      {
        method: "GET",
        path: "/customers",
        query: {
          q: params.q,
          updated_since: params.updatedSince,
          page: params.page,
          page_size: params.pageSize,
        },
      },
      options,
    );
  }

  /** Percorre TODOS os clientes, página a página (`for await`). */
  listAll(params: CustomerListAllParams = {}, options?: RequestOptions): AsyncIterableIterator<Customer> {
    const { pageSize = 100, ...filters } = params;
    return paginate((page) => this.list({ ...filters, page, pageSize }, options));
  }

  /** Exclui um cliente. `DELETE /customers/{external_id}` */
  delete(externalId: string, options?: RequestOptions): Promise<Deleted> {
    return this.#t.data({ method: "DELETE", path: customerPath(externalId) }, options);
  }
}
