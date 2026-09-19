/**
 * SDK oficial do bFocus para Node.js/TypeScript.
 *
 * @example
 * ```ts
 * import { Bfocus } from "@bfocus/sdk";
 * const bf = new Bfocus({ apiKey: process.env.BFOCUS_API_KEY! });
 * ```
 */
export { Bfocus } from "./client.js";
export type { BfocusOptions, BfocusClientOptions } from "./client.js";
export { BATCH_MAX, DEFAULT_BASE_URL } from "./core.js";
export type { FetchLike, FetchResponseLike, RequestOptions, SleepFn } from "./core.js";
export {
  BfocusError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServerError,
  NetworkError,
} from "./errors.js";
export type { BfocusErrorInit } from "./errors.js";
export { signWidgetIdentity, signWidgetIdentityV2 } from "./signature.js";
export type { SignWidgetIdentityV2Options } from "./signature.js";
export { VERSION } from "./version.js";
export type {
  Customers,
  CustomerContacts,
  CustomerProducts,
  CustomerInteractions,
  CustomerIdentifiers,
} from "./resources/customers.js";
export type { People, PeopleIdentifiers } from "./resources/people.js";
export type { Products } from "./resources/products.js";
export type { ReleaseNotes } from "./resources/releaseNotes.js";
export type { Kb, KbArticles } from "./resources/kb.js";
export type { AiAgents } from "./resources/aiAgents.js";
export type {
  AiAgent,
  AiAgentPreview,
  AiAgentPreviewParams,
  AiAgentPreviewTurn,
  BatchItemResult,
  BatchResult,
  BatchSummary,
  Contact,
  ContactUpsertParams,
  Customer,
  CustomerBatchItem,
  CustomerListAllParams,
  CustomerListParams,
  CustomerUpsertParams,
  CustomerWithIdentifiers,
  CustomField,
  CustomFieldInput,
  CustomFieldType,
  Deleted,
  Identifier,
  IdentifierAddParams,
  Interaction,
  InteractionCreateParams,
  InteractionListAllParams,
  InteractionListParams,
  KbArticle,
  KbArticleBatchItem,
  KbArticleListAllParams,
  KbArticleListParams,
  KbArticleStatus,
  KbArticleSummary,
  KbArticleUpsertParams,
  KbBatchItemResult,
  KbBatchResult,
  KbSearchHit,
  KbSearchParams,
  Page,
  Person,
  PersonBatchItem,
  PersonIdentifiers,
  PersonUpsertParams,
  PersonUpsertResult,
  Product,
  ProductListParams,
  ProductRef,
  ProductUpsertParams,
  ReleaseNote,
  ReleaseNoteAudience,
  ReleaseNoteListAllParams,
  ReleaseNoteListParams,
  ReleaseNoteUpsertParams,
  UpsertStatus,
} from "./types.js";
