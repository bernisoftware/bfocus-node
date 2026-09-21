/**
 * Tipos públicos da SDK.
 *
 * Convenção:
 * - **Entrada** (parâmetros dos métodos) em camelCase — a SDK converte para o snake_case do fio.
 *   `undefined`/ausente = campo omitido (não muda nada); `null` = `null` explícito (LIMPA o campo).
 * - **Saída** (entidades devolvidas) exatamente como a API documenta, em snake_case: é o JSON
 *   da resposta, sem cópia nem renomeação. Campos novos que a API passar a devolver chegam
 *   intactos (a API evolui de forma aditiva).
 */

// ── Paginação ────────────────────────────────────────────────────────────────

/** Uma página de uma listagem paginada. */
export interface Page<T> {
  /** Itens desta página. */
  items: T[];
  /** Número da página (começa em 1). */
  page: number;
  /** Tamanho da página pedido. */
  pageSize: number;
  /** Total de itens em todas as páginas. */
  total: number;
  /** Total de páginas. */
  pages: number;
}

/** Resposta de exclusão. */
export interface Deleted {
  deleted: boolean;
}

// ── Clientes ─────────────────────────────────────────────────────────────────

/** Tipos aceitos em campos customizados. */
export type CustomFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "url"
  | "number"
  | "date"
  | "datetime"
  | "bool"
  | "select"
  | "file";

/**
 * Campo customizado enviado no upsert de cliente **ou de pessoa**.
 *
 * `visibility` não entra aqui: quem vê o campo é decisão do bFocus e é preservada entre
 * sincronizações — o seu sistema não rebaixa nem promove a exposição de um dado sem querer.
 */
export interface CustomFieldInput {
  /** Chave estável do campo no seu sistema. */
  key: string;
  /** Rótulo exibido no bFocus. */
  label?: string;
  /** Tipo do campo (padrão `text`). */
  type?: CustomFieldType;
  /** Valor (qualquer JSON). */
  value?: unknown;
  /** Opções, para `select`. */
  options?: string[] | null;
}

/** Campo customizado de um cliente ou de uma pessoa, como a API devolve. */
export interface CustomField {
  key: string;
  label: string | null;
  type: string;
  value: unknown;
  /** Quem vê o campo no bFocus (definido no painel). */
  visibility: string;
  [key: string]: unknown;
}

/** Cliente (empresa atendida). */
/**
 * Tipo do CONTRATANTE: `pj` (empresa) ou `pf` (pessoa física). Cliente é a CONTA, não a pessoa:
 * uma conta PF pode ter várias pessoas dentro (o titular e quem ele autorizar).
 */
export type CustomerKind = "pj" | "pf";

export interface Customer {
  id: string;
  external_id: string;
  /** O nome usado em tudo. Na PJ é o nome fantasia; a razão social fica em `legal_name`. */
  name: string;
  /** `null` = ninguém declarou e o documento não diz. */
  kind: CustomerKind | null;
  /** Só PJ: razão social, quando difere do nome fantasia. */
  legal_name: string | null;
  /** Só PJ: inscrição estadual (aceita `ISENTO`). */
  state_registration: string | null;
  /** Só PJ: inscrição municipal. */
  municipal_registration: string | null;
  /** Só PF: RG e órgão emissor (texto livre — o formato varia por estado). */
  id_document: string | null;
  /** CNPJ (PJ) ou CPF (PF), sem máscara. */
  document: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  custom_fields: CustomField[];
  is_active: boolean;
  /** Logotipo do cliente, como a equipe subiu no bFocus. `null` = sem logotipo. */
  logo_url: string | null;
  /** E-mails adicionais do cliente (o principal é `email`). */
  extra_emails: string[];
  /** Telefones adicionais do cliente (o principal é `phone`). */
  extra_phones: string[];
  created_at: string | null;
  updated_at: string | null;
}

/** Contato de um cliente. */
export interface Contact {
  id: string;
  external_id: string | null;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_primary: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** Referência curta a um produto. */
export interface ProductRef {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
}

/** Interação (nota interna ou registro visível) na linha do tempo do cliente. */
export interface Interaction {
  id: string;
  /** HTML. */
  content: string;
  is_internal: boolean;
  /** `human` (assinado por `author_email`) ou `system`. */
  author_kind: string;
  author_name: string | null;
  created_at: string | null;
}

/** Parâmetros de `customers.upsert`. Só os campos informados mudam; `null` limpa. */
export interface CustomerUpsertParams {
  name?: string | null;
  document?: string | null;
  /** Tipo do contratante: `pj` (empresa) ou `pf` (pessoa física). Omitido, sai do documento. */
  kind?: CustomerKind | null;
  /** Só PJ: razão social, quando difere do nome fantasia que vai em `name`. */
  legalName?: string | null;
  /** Só PJ: inscrição estadual (aceita `ISENTO`). */
  stateRegistration?: string | null;
  /** Só PJ: inscrição municipal. */
  municipalRegistration?: string | null;
  /** Só PF: RG e órgão emissor. */
  idDocument?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  /** Quando enviada, SUBSTITUI a lista de campos customizados. */
  customFields?: CustomFieldInput[] | null;
}

/** Parâmetros de `customers.list`. */
export interface CustomerListParams {
  /** Busca por nome, documento, e-mail… */
  q?: string;
  /** Só clientes alterados a partir deste instante (`Date` ou ISO 8601). */
  updatedSince?: Date | string;
  page?: number;
  pageSize?: number;
}

/** Parâmetros de `customers.listAll`. */
export interface CustomerListAllParams {
  q?: string;
  updatedSince?: Date | string;
  /** Itens por requisição (padrão 100). */
  pageSize?: number;
}

/** Parâmetros de `customers.contacts.upsert`. Só os campos informados mudam; `null` limpa. */
export interface ContactUpsertParams {
  /** Obrigatório ao criar. */
  name?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  isPrimary?: boolean | null;
}

/** Parâmetros de `customers.interactions.list`. */
export interface InteractionListParams {
  page?: number;
  pageSize?: number;
}

/** Parâmetros de `customers.interactions.listAll`. */
export interface InteractionListAllParams {
  /** Itens por requisição (padrão 100). */
  pageSize?: number;
}

/** Parâmetros opcionais de `customers.interactions.create`. */
export interface InteractionCreateParams {
  /** Nota interna (padrão da API: `true`) ou registro visível ao cliente. */
  isInternal?: boolean;
  /** E-mail de um usuário do bFocus que assina o registro. Omitido = "sistema". */
  authorEmail?: string | null;
}

/** Um item de `customers.batch`: os mesmos campos de `customers.upsert` + o `externalId`. */
export interface CustomerBatchItem extends CustomerUpsertParams {
  /** `external_id` do cliente no seu sistema (obrigatório no item). */
  externalId: string;
}

// ── Identificadores extras ───────────────────────────────────────────────────

/** Identificador extra (id de outro sistema seu) ligado a um cliente ou a uma pessoa. */
export interface Identifier {
  external_id: string;
  label: string | null;
  /** Quem ligou: `api`, `panel`, `import`… */
  source: string;
}

/** Cliente com a lista de identificadores extras (resposta de `customers.identifiers.*`). */
export interface CustomerWithIdentifiers extends Customer {
  /** Identificadores extras (o principal é `external_id`). */
  identifiers: Identifier[];
}

/** Identificadores extras de uma pessoa (resposta de `people.identifiers.*`). */
export interface PersonIdentifiers {
  /** Identificador principal da pessoa. */
  external_id: string | null;
  identifiers: Identifier[];
}

/** Parâmetros opcionais de `customers.identifiers.add` / `people.identifiers.add`. */
export interface IdentifierAddParams {
  /** Rótulo livre (ex.: nome do sistema). Omitido = a requisição vai sem corpo. */
  label?: string | null;
}

// ── Pessoas ──────────────────────────────────────────────────────────────────

/** Pessoa de um cliente (quem abre chamados pelo widget/portal). */
export interface Person {
  /** `null` = contato do cliente sem acesso (sem identificador). */
  external_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  /** CPF da pessoa, só os 11 dígitos (`null` = não informado). */
  document: string | null;
  role: string | null;
  /** Pode abrir o widget/portal do cliente. */
  access: boolean;
  is_primary: boolean;
  /** `external_id` principal do cliente a que a pessoa pertence. */
  customer_external_id: string;
  /** Campos personalizados da pessoa (a `visibility` é definida no bFocus). */
  custom_fields: CustomField[];
  /**
   * Identificadores EXTRAS desta pessoa: os outros ids pelos quais ela também é encontrada
   * (o principal é `external_id`). É por aqui que você descobre que o id do SEU sistema virou
   * apelido do cadastro de outro.
   */
  identifiers: Identifier[];
}

/** Status de um upsert/item de lote que deu certo. */
export type UpsertStatus = "created" | "updated" | "unchanged";

/** Resultado de `people.upsert`: a pessoa + o que aconteceu. */
export interface PersonUpsertResult extends Person {
  status: UpsertStatus;
  /**
   * `true` = a pessoa JÁ EXISTIA em outro cliente e esta chamada a ligou também a este.
   * O cadastro é único e ela circula pelos dois — nada foi transferido nem duplicado.
   */
  linked: boolean;
  /** O id que você enviou é um APELIDO: este é o `external_id` principal do cadastro. */
  merged_into: string | null;
}

/** Resultado de `people.delete`: a pessoa + se ela apenas saiu DESTE cliente. */
export interface PersonRevokeResult extends Person {
  /**
   * `true` = ela continua com acesso, porque também é de outros clientes (o acesso é do
   * vínculo). `false` = era só deste cliente e foi desligada, como sempre.
   */
  unlinked: boolean;
}

/** Parâmetros de `people.upsert`. Só os campos informados mudam; `null` vai como `null`. */
export interface PersonUpsertParams {
  /** Obrigatório ao criar. */
  name?: string | null;
  /** Identifica a pessoa já cadastrada (sem duplicar). */
  email?: string | null;
  phone?: string | null;
  /**
   * CPF da pessoa, com ou sem máscara (a resposta traz só os 11 dígitos).
   *
   * A PESSOA É ÚNICA: o mesmo CPF é sempre o mesmo cadastro, em qualquer produto. Id
   * desconhecido + CPF de uma ficha existente → a resposta vem com `merged_into` = id
   * principal dela (o seu id vira identificador extra). Id de uma ficha + CPF de OUTRA → as
   * duas são mescladas na hora (`merged_into` = a que tinha o CPF). `null`/vazio NÃO apaga (não
   * é campo do `clear`). Erros: 422 `PERSON_DOCUMENT_INVALID` (CPF inválido) e 409
   * `PERSON_DOCUMENT_CONFLICT` (a ficha já tem OUTRO CPF — nunca troca sozinho).
   */
  document?: string | null;
  role?: string | null;
  /** Acesso ao widget/portal. Padrão ao criar: `true`. */
  access?: boolean | null;
  isPrimary?: boolean | null;
  /** E-mails adicionais da mesma pessoa. */
  extraEmails?: string[] | null;
  /** Telefones adicionais da mesma pessoa. */
  extraPhones?: string[] | null;
  /**
   * Campos personalizados da pessoa. Diferente de `extraEmails`/`extraPhones`, a lista
   * SUBSTITUI a lista inteira: mande o que o seu sistema tem hoje, porque campo que ficar de
   * fora é REMOVIDO. Omitir a propriedade não mexe em nada.
   */
  customFields?: CustomFieldInput[] | null;
  /**
   * Campos a **APAGAR** nesta pessoa: `["email"]`, `["phone"]` ou os dois.
   *
   * Apagar é EXPLÍCITO. `phone: null`, `clear: []` e omitir a propriedade continuam
   * significando "não mexe" — a SDK não traduz `null` em `clear`. Campo fora da lista aceita
   * é RECUSADO (422 `PERSON_CLEAR_FIELD_INVALID`), não ignorado. E só se limpa a PRÓPRIA
   * ficha: alcançando a pessoa por um identificador EXTRA, a API recusa com 409
   * `PERSON_CLEAR_NOT_OWN_RECORD`.
   */
  clear?: string[] | null;
}

/** Um item de `people.batch`: cliente + `externalId` da pessoa + os campos de `people.upsert`. */
export interface PersonBatchItem extends PersonUpsertParams {
  /** `external_id` do cliente a que a pessoa pertence. */
  customerExternalId: string;
  /** `external_id` da pessoa no seu sistema (sem `:`, é o id assinado no widget). */
  externalId: string;
}

// ── Lotes ────────────────────────────────────────────────────────────────────

/** Resultado de um item de `customers.batch` / `people.batch`. */
export interface BatchItemResult {
  /** Posição do item no lote ENVIADO (0 = primeiro). */
  index: number;
  status: UpsertStatus | "error";
  /** Identificador do item (o principal, depois do upsert). */
  external_id: string | null;
  /** Quando o cadastro foi unificado a outro: o `external_id` que passou a valer. Atualize do seu lado. */
  merged_into: string | null;
  /** A pessoa já existia em outro cliente e este item a ligou também a este (cadastro único). */
  linked: boolean;
  /** Código estável do erro (`status = "error"`). */
  error: string | null;
  /** Status HTTP que o item teria sozinho (só em erro). */
  code: number | null;
}

/** Contadores de um lote. */
export interface BatchSummary {
  created: number;
  updated: number;
  unchanged: number;
  error: number;
}

/** Resultado de `customers.batch` / `people.batch`. Um erro não desfaz os outros itens. */
export interface BatchResult {
  /** Um resultado por item, na ordem enviada. */
  results: BatchItemResult[];
  summary: BatchSummary;
}

// ── Produtos ─────────────────────────────────────────────────────────────────

/** Produto do catálogo. */
export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  /** Maior versão publicada em release notes. */
  current_version: string;
  /** `none`, `assisted` ou `autonomous` (definido no painel). */
  ai_level: string;
  created_at: string | null;
  updated_at: string | null;
}

/** Parâmetros de `products.list`. */
export interface ProductListParams {
  /** Inclui os arquivados. */
  includeInactive?: boolean;
}

/** Parâmetros de `products.upsert`. Só os campos informados mudam; `null` limpa. */
export interface ProductUpsertParams {
  /** Obrigatório ao criar. */
  name?: string | null;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
}

// ── Release notes ────────────────────────────────────────────────────────────

/** Quem vê a release note: equipe, clientes no widget, ou os dois. */
export type ReleaseNoteAudience = "internal" | "external" | "both";

/** Release note de uma versão de produto. */
export interface ReleaseNote {
  id: string;
  /** Slug do produto. */
  product: string;
  version: string;
  title: string;
  description_html: string;
  audience: string;
  is_published: boolean;
  require_ack_internal: boolean;
  require_ack_external: boolean;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Parâmetros de `releaseNotes.list`. */
export interface ReleaseNoteListParams {
  /** `true` = só publicadas; `false` = só rascunhos. */
  published?: boolean;
  page?: number;
  pageSize?: number;
}

/** Parâmetros de `releaseNotes.listAll`. */
export interface ReleaseNoteListAllParams {
  published?: boolean;
  /** Itens por requisição (padrão 100). */
  pageSize?: number;
}

/** Parâmetros de `releaseNotes.upsert`. Só os campos informados mudam; `null` limpa. */
export interface ReleaseNoteUpsertParams {
  /** Obrigatório ao criar. */
  title?: string | null;
  /** Corpo em HTML (sanitizado). */
  descriptionHtml?: string | null;
  /** Corpo em Markdown. Use este OU o HTML. */
  descriptionMarkdown?: string | null;
  /** Padrão ao criar: `both`. */
  audience?: ReleaseNoteAudience | null;
  requireAckInternal?: boolean | null;
  requireAckExternal?: boolean | null;
  /** Publica depois de salvar. Já publicada = nada muda. */
  publish?: boolean;
}

// ── Base de conhecimento ─────────────────────────────────────────────────────

/** Estado de um artigo. Só `published` alimenta o agente de IA. */
export type KbArticleStatus = "draft" | "published";

/** Artigo da base de conhecimento, sem o corpo (listagens e resultados de lote). */
export interface KbArticleSummary {
  id: string;
  external_id: string | null;
  /** Slug do produto; `null` = vale para todos. */
  product: string | null;
  title: string;
  excerpt: string;
  status: string;
  origin: string;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Artigo completo da base de conhecimento (`get`, `upsert`, `publish`, `unpublish`). */
export interface KbArticle extends KbArticleSummary {
  /** Corpo em HTML (sanitizado). */
  body_html: string;
}

/** Resultado de busca na base de conhecimento. */
export interface KbSearchHit {
  id: string;
  external_id: string | null;
  title: string;
  excerpt: string;
}

/** Parâmetros de `kb.articles.list`. */
export interface KbArticleListParams {
  /** Só os artigos deste produto (slug). */
  product?: string;
  status?: KbArticleStatus;
  /** Busca no título e no texto. */
  q?: string;
  updatedSince?: Date | string;
  page?: number;
  pageSize?: number;
}

/** Parâmetros de `kb.articles.listAll`. */
export interface KbArticleListAllParams {
  product?: string;
  status?: KbArticleStatus;
  q?: string;
  updatedSince?: Date | string;
  /** Itens por requisição (padrão 100, o máximo da API). */
  pageSize?: number;
}

/** Parâmetros de `kb.articles.upsert`. Só os campos informados mudam; `null` limpa. */
export interface KbArticleUpsertParams {
  /** Obrigatório ao criar. */
  title?: string | null;
  /** Corpo em HTML (sanitizado). */
  bodyHtml?: string | null;
  /** Corpo em Markdown. Use este OU o HTML. */
  bodyMarkdown?: string | null;
  /** Slug do produto. `null` explícito = artigo global (vale para todos os produtos). */
  product?: string | null;
  /** Omitido = mantém (rascunho ao criar). */
  status?: KbArticleStatus | null;
}

/** Um item de `kb.articles.batchUpsert`. */
export interface KbArticleBatchItem extends KbArticleUpsertParams {
  /** `external_id` do artigo no seu sistema. Sem `/` — use `:` para hierarquia. */
  externalId: string;
}

/** Resultado de um item do lote. */
export interface KbBatchItemResult {
  external_id: string;
  ok: boolean;
  action: "created" | "updated" | "unchanged" | null;
  /** Código do erro quando `ok` é falso. */
  error: string | null;
  article: KbArticleSummary | null;
}

/** Resultado (agregado) de `kb.articles.batchUpsert`. */
export interface KbBatchResult {
  /** Um resultado por artigo, na ordem enviada. */
  results: KbBatchItemResult[];
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

/** Parâmetros de `kb.search`. */
export interface KbSearchParams {
  /** Slug do produto. */
  product?: string;
  /** Máximo de resultados (1–20, padrão da API: 5). */
  limit?: number;
}

// ── Agentes de IA ────────────────────────────────────────────────────────────

/** Agente de IA de atendimento. */
export interface AiAgent {
  id: string;
  name: string;
  product: ProductRef;
  active: boolean;
  persona: string | null;
  /** O que o agente atende e o que não atende. */
  scope: string | null;
  avatar_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Uma fala do histórico enviado ao `aiAgents.preview`. */
export interface AiAgentPreviewTurn {
  role: "customer" | "bot";
  content: string;
}

/** Parâmetros opcionais de `aiAgents.preview`. */
export interface AiAgentPreviewParams {
  /** Conversa anterior (até 20 falas). */
  history?: AiAgentPreviewTurn[];
}

/** Resposta simulada de um agente de IA. */
export interface AiAgentPreview {
  /** `answer`, `handoff` (transferiria a um humano) ou `refuse`. */
  action: string;
  answer_html: string | null;
  escalated: boolean;
  refused: boolean;
  handoff_reason: string | null;
  confidence: number | null;
  topic: string | null;
  guards: string[];
  citations: unknown[];
  sources: Record<string, unknown>[];
  collected: Record<string, unknown>;
  missing: unknown[];
  [key: string]: unknown;
}
