/**
 * Erros da SDK.
 *
 * Toda resposta fora de 2xx vira um {@link BfocusError} (ou subclasse). A lógica do seu
 * código deve usar SEMPRE o `code` — estável, vem de `body.error` — e nunca o `message`,
 * que é texto para humanos e pode mudar.
 */

/** Dados para construir um {@link BfocusError}. */
export interface BfocusErrorInit {
  /** Código estável (ex.: `CUSTOMER_NOT_FOUND`, `VALIDATION_ERROR`, `HTTP_404`). */
  code: string;
  /** Status HTTP (`0` em erro de rede). */
  status: number;
  /** Texto legível. Se omitido, é montado a partir do código e do contexto. */
  message?: string;
  /** Id da requisição (`body.request_id` ou header `X-Request-Id`). */
  requestId?: string;
  /** Campo → motivo (erros 422). */
  validation?: Record<string, string>;
  /** `body.data` — o detalhe estruturado de alguns erros. */
  data?: Record<string, unknown>;
  /** Segundos do header `Retry-After` (só 429). */
  retryAfter?: number;
  /** Escopo que faltou na chave (header `X-Required-Scope`, só 403). */
  requiredScope?: string;
  /** Erro original (ex.: falha de rede do `fetch`). */
  cause?: unknown;
}

function describe(init: BfocusErrorInit): string {
  const ctx: string[] = [init.status === 0 ? "sem resposta da API" : `HTTP ${init.status}`];
  if (init.requiredScope) ctx.push(`escopo exigido: ${init.requiredScope}`);
  if (init.retryAfter !== undefined) ctx.push(`tente de novo em ${init.retryAfter}s`);
  if (init.requestId) ctx.push(`request_id: ${init.requestId}`);
  let text = `${init.code} (${ctx.join(", ")})`;
  const fields = Object.entries(init.validation ?? {});
  if (fields.length > 0) text += `: ${fields.map(([k, v]) => `${k}: ${v}`).join("; ")}`;
  return text;
}

/** Erro base de toda falha de chamada à API do bFocus. */
export class BfocusError extends Error {
  /** Código estável do erro — use este campo na sua lógica. */
  readonly code: string;
  /** Status HTTP (`0` em erro de rede). */
  readonly status: number;
  /** Id da requisição; informe ao suporte para achar a chamada no log. */
  readonly requestId: string | undefined;
  /** Campo → motivo, em erros de validação (422). Vazio nos demais. */
  readonly validation: Record<string, string>;
  /**
   * O `data` do corpo do erro: o detalhe estruturado que alguns erros trazem. Vazio nos demais.
   *
   * É onde vem, por exemplo, de quem é o contato já usado num 409 `PERSON_EMAIL_TAKEN` /
   * `PERSON_PHONE_TAKEN` (`field`, `owner_external_id`, `owner_name`,
   * `owner_customer_external_id`) e o `owner` de um `IDENTIFIER_IN_USE`. A API repete esse
   * detalhe em {@link validation}, por compatibilidade com as SDKs que ainda não expunham `data`.
   */
  readonly data: Record<string, unknown>;
  /** Segundos pedidos pelo header `Retry-After` (só em 429). */
  readonly retryAfter: number | undefined;
  /** Escopo que faltou na chave de API (só em 403 de escopo). */
  readonly requiredScope: string | undefined;

  constructor(init: BfocusErrorInit) {
    super(init.message ?? describe(init), init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "BfocusError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.validation = init.validation ?? {};
    this.data = init.data ?? {};
    this.retryAfter = init.retryAfter;
    this.requiredScope = init.requiredScope;
  }

  /** Representação para logs estruturados (`JSON.stringify(err)`). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      message: this.message,
      requestId: this.requestId,
      validation: this.validation,
      data: this.data,
      retryAfter: this.retryAfter,
      requiredScope: this.requiredScope,
    };
  }
}

/** 401 — chave ausente, inválida ou revogada. */
export class AuthenticationError extends BfocusError {
  constructor(init: BfocusErrorInit) {
    super(init);
    this.name = "AuthenticationError";
  }
}

/** 403 — chave sem o escopo da operação (`requiredScope`), desligada ou IP não liberado. */
export class PermissionDeniedError extends BfocusError {
  constructor(init: BfocusErrorInit) {
    super(init);
    this.name = "PermissionDeniedError";
  }
}

/** 404 — recurso inexistente (ex.: `CUSTOMER_NOT_FOUND`). */
export class NotFoundError extends BfocusError {
  constructor(init: BfocusErrorInit) {
    super(init);
    this.name = "NotFoundError";
  }
}

/** 409 — conflito de estado (ex.: `KB_ARTICLE_EMPTY`, `AI_DISABLED`). */
export class ConflictError extends BfocusError {
  constructor(init: BfocusErrorInit) {
    super(init);
    this.name = "ConflictError";
  }
}

/** 422 — corpo ou parâmetro inválido; detalhes em `validation`. */
export class ValidationError extends BfocusError {
  constructor(init: BfocusErrorInit) {
    super(init);
    this.name = "ValidationError";
  }
}

/** 429 — limite de requisições da chave; `retryAfter` diz quanto esperar. */
export class RateLimitError extends BfocusError {
  constructor(init: BfocusErrorInit) {
    super(init);
    this.name = "RateLimitError";
  }
}

/** 5xx — erro do lado do bFocus (informe o `requestId`). */
export class ServerError extends BfocusError {
  constructor(init: BfocusErrorInit) {
    super(init);
    this.name = "ServerError";
  }
}

/** Falha de conexão ou tempo esgotado: `status = 0`, `code = "NETWORK_ERROR"`. */
export class NetworkError extends BfocusError {
  constructor(init: { reason: string; requestId?: string; cause?: unknown }) {
    super({
      code: "NETWORK_ERROR",
      status: 0,
      requestId: init.requestId,
      cause: init.cause,
      message: `NETWORK_ERROR (sem resposta da API: ${init.reason}${
        init.requestId ? `, request_id: ${init.requestId}` : ""
      })`,
    });
    this.name = "NetworkError";
  }
}

/** Escolhe a classe de erro pelo status HTTP. */
export function errorForStatus(init: BfocusErrorInit): BfocusError {
  switch (init.status) {
    case 401:
      return new AuthenticationError(init);
    case 403:
      return new PermissionDeniedError(init);
    case 404:
      return new NotFoundError(init);
    case 409:
      return new ConflictError(init);
    case 422:
      return new ValidationError(init);
    case 429:
      return new RateLimitError(init);
    default:
      return init.status >= 500 ? new ServerError(init) : new BfocusError(init);
  }
}
