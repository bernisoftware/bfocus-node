/**
 * Transporte HTTP: headers, codificação de caminho/query, novas tentativas e erros.
 * Interno — a superfície pública é a classe `Bfocus` e seus recursos.
 */
import { randomUUID } from "node:crypto";
import { BfocusError, NetworkError, errorForStatus } from "./errors.js";
import type { BatchResult, IdentifierAddParams, Page } from "./types.js";
import { CLIENT_ID } from "./version.js";

/** URL base padrão (produção). */
export const DEFAULT_BASE_URL = "https://api.bfocus.com.br";

/** Prefixo de todas as rotas da API pública. */
export const API_PREFIX = "/api/v1/integration";

/** Resposta mínima que a SDK consome de um `fetch`. */
export interface FetchResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Assinatura mínima de `fetch` que a SDK usa — o `fetch` global do Node 18+ serve. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Opções por chamada, aceitas como último argumento de todo método. */
export interface RequestOptions {
  /**
   * `Idempotency-Key` desta escrita. Padrão: um uuid4 gerado por chamada e repetido nas
   * novas tentativas. Passe o seu para tornar segura a repetição da MESMA operação entre
   * execuções (ex.: um job que pode rodar duas vezes).
   */
  idempotencyKey?: string;
  /** Tempo máximo por tentativa, em ms (sobrepõe o do cliente). */
  timeout?: number;
  /** Novas tentativas além da primeira (sobrepõe o do cliente). */
  maxRetries?: number;
  /** Cancela a chamada (inclusive a espera entre tentativas). Não é tentado de novo. */
  signal?: AbortSignal;
}

/** Função de espera entre tentativas. */
export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | Date | null | undefined;

/** Uma requisição lógica. `body: undefined` = sem corpo. */
export interface RequestSpec {
  method: HttpMethod;
  /** Caminho a partir de {@link API_PREFIX}, com os segmentos já codificados. */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface TransportConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  fetch: FetchLike;
  sleep: SleepFn;
}

const WRITE_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_AFTER_S = 60;

// ── Codificação ──────────────────────────────────────────────────────────────

/**
 * Percent-encoding estrito (RFC 3986) de UM segmento de caminho: `ERP 1042` → `ERP%201042`,
 * `a/b` → `a%2Fb`.
 *
 * `.` e `..` são recusados: o parser de URL (WHATWG, usado pelo `fetch`) os resolve como
 * "diretório atual/pai" mesmo codificados (`%2E%2E`), então nenhum cliente HTTP consegue
 * endereçá-los — a requisição iria para outra rota.
 */
export function encodeSegment(value: string, name: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`bFocus: \`${name}\` é obrigatório (string).`);
  }
  const raw = String(value);
  if (raw === "") throw new TypeError(`bFocus: \`${name}\` não pode ser vazio.`);
  if (raw === "." || raw === "..") {
    throw new TypeError(`bFocus: \`${name}\` não pode ser "${raw}" (não é endereçável num caminho HTTP).`);
  }
  return encodeURIComponent(raw).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Segmento de `external_id` de artigo: a API recusa `/` (use `:` para hierarquia). */
export function encodeArticleId(value: string, name = "externalId"): string {
  if (typeof value === "string" && value.includes("/")) {
    throw new TypeError(
      `bFocus: \`${name}\` de artigo não aceita "/" (use ":" para hierarquia): ${JSON.stringify(value)}`,
    );
  }
  return encodeSegment(value, name);
}

/** `Date` → ISO 8601 em UTC com `Z` (sem milissegundos quando zerados). */
export function toIsoUtc(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new TypeError("bFocus: data inválida.");
  return value.toISOString().replace(/\.000Z$/, "Z");
}

function formatQueryValue(value: Exclude<QueryValue, null | undefined>): string {
  if (value instanceof Date) return toIsoUtc(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Monta `?a=1&b=2` omitindo `undefined`/`null`. */
export function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(formatQueryValue(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * Copia de `params` só as chaves presentes (≠ `undefined`), renomeando camelCase → snake_case
 * pelo mapa. `null` passa como `null` (limpa o campo na API).
 */
export function pick(
  params: object | undefined | null,
  map: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!params) return out;
  const src = params as Record<string, unknown>;
  for (const [from, to] of Object.entries(map)) {
    const value = src[from];
    if (value !== undefined) out[to] = value;
  }
  return out;
}

// ── Lotes (customers.batch / people.batch) ───────────────────────────────────

/**
 * Máximo de itens por chamada de `customers.batch` / `people.batch`. Acima disso a SDK lança
 * `TypeError` antes de qualquer requisição — ela NÃO divide sozinha, para que o `index` de cada
 * resultado seja sempre a posição no lote que você enviou.
 */
export const BATCH_MAX = 500;

/** Valida a lista de um lote: precisa ser array com até `BATCH_MAX` itens. */
export function checkBatch(op: string, items: unknown): asserts items is readonly unknown[] {
  if (!Array.isArray(items)) throw new TypeError(`bFocus: ${op} espera uma lista de itens.`);
  if (items.length > BATCH_MAX) {
    throw new TypeError(
      `bFocus: ${op} aceita até ${BATCH_MAX} itens por chamada (recebeu ${items.length}); ` +
        `divida em lotes de ${BATCH_MAX}.`,
    );
  }
}

/** Resultado de lote vazio (nenhuma requisição foi feita). */
export const emptyBatchResult = (): BatchResult => ({
  results: [],
  summary: { created: 0, updated: 0, unchanged: 0, error: 0 },
});

/** `external_id` obrigatório num item de lote (string não vazia). */
export function requireItemId(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`bFocus: ${name} é obrigatório (string não vazia).`);
  }
  return value;
}

/** Corpo de `identifiers.add`: `{"label": …}` só quando `label` veio; senão, sem corpo. */
export const identifierBody = (params: IdentifierAddParams | undefined): Record<string, unknown> | undefined => {
  const body = pick(params, { label: "label" });
  return Object.keys(body).length ? body : undefined;
};

// ── Novas tentativas ─────────────────────────────────────────────────────────

/** Segundos de um header `Retry-After` (número ou data HTTP). */
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const at = Date.parse(text);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** Espera antes da nova tentativa `attempt` (0 = primeira nova tentativa), em ms. */
export function retryDelayMs(attempt: number, retryAfter: number | undefined): number {
  if (retryAfter !== undefined) return Math.min(retryAfter, MAX_RETRY_AFTER_S) * 1000;
  const base = Math.min(8, 0.5 * 2 ** attempt);
  return Math.round((base + base * 0.25 * Math.random()) * 1000);
}

/** Espera padrão: `setTimeout`, interrompida pelo `signal`. */
export const defaultSleep: SleepFn = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

// ── Respostas ────────────────────────────────────────────────────────────────

type Json = unknown;

function parseJson(text: string): { ok: true; value: Json } | { ok: false } {
  if (text.trim() === "") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch {
    return { ok: false };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function buildError(
  status: number,
  headers: FetchResponseLike["headers"],
  text: string,
  sentRequestId: string,
): BfocusError {
  const parsed = parseJson(text);
  const body = parsed.ok && isObject(parsed.value) ? parsed.value : undefined;
  const code = nonEmptyString(body?.error) ?? nonEmptyString(body?.message) ?? `HTTP_${status}`;
  const validation: Record<string, string> = {};
  if (isObject(body?.validation)) {
    for (const [k, v] of Object.entries(body.validation)) validation[k] = String(v);
  }
  return errorForStatus({
    code,
    status,
    requestId:
      nonEmptyString(body?.request_id) ?? nonEmptyString(headers.get("x-request-id")) ?? sentRequestId,
    validation,
    retryAfter: status === 429 ? parseRetryAfter(headers.get("retry-after")) : undefined,
    requiredScope: status === 403 ? (nonEmptyString(headers.get("x-required-scope")) ?? undefined) : undefined,
  });
}

function invalidResponse(status: number, requestId: string, detail: string): BfocusError {
  return new BfocusError({
    code: "INVALID_RESPONSE",
    status,
    requestId,
    message: `INVALID_RESPONSE (HTTP ${status}, ${detail}, request_id: ${requestId})`,
  });
}

// ── Transporte ───────────────────────────────────────────────────────────────

/** Executa requisições lógicas contra a API. Interno. */
export class Transport {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #timeout: number;
  readonly #maxRetries: number;
  readonly #fetch: FetchLike;
  readonly #sleep: SleepFn;

  constructor(config: TransportConfig) {
    this.baseUrl = config.baseUrl;
    this.#apiKey = config.apiKey;
    this.#timeout = config.timeout;
    this.#maxRetries = config.maxRetries;
    this.#fetch = config.fetch;
    this.#sleep = config.sleep;
  }

  /** Faz a chamada (com novas tentativas) e devolve o envelope JSON de sucesso. */
  async request(spec: RequestSpec, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = this.baseUrl + API_PREFIX + spec.path + buildQuery(spec.query);
    const requestId = randomUUID().replace(/-/g, "");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "X-Bfocus-Client": CLIENT_ID,
      "User-Agent": CLIENT_ID,
      "X-Request-Id": requestId,
    };
    if (WRITE_METHODS.has(spec.method)) {
      headers["Idempotency-Key"] = options.idempotencyKey ?? randomUUID();
    }
    let payload: string | undefined;
    if (spec.body !== undefined) {
      payload = JSON.stringify(spec.body);
      headers["Content-Type"] = "application/json";
    }
    const timeout = options.timeout ?? this.#timeout;
    const maxRetries = options.maxRetries ?? this.#maxRetries;
    const signal = options.signal;

    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let status: number;
      let resHeaders: FetchResponseLike["headers"];
      let text: string;
      try {
        ({ status, headers: resHeaders, text } = await this.#attempt(
          url,
          spec.method,
          headers,
          payload,
          timeout,
          signal,
        ));
      } catch (err) {
        if (signal?.aborted) throw err; // cancelado por quem chamou: propaga, sem nova tentativa
        const error =
          err instanceof TimeoutSignal
            ? new NetworkError({ reason: `tempo esgotado após ${timeout} ms`, requestId })
            : new NetworkError({ reason: describeCause(err), requestId, cause: err });
        if (attempt < maxRetries) {
          await this.#sleep(retryDelayMs(attempt, undefined), signal);
          continue;
        }
        throw error;
      }

      if (status >= 200 && status < 300) {
        const parsed = parseJson(text);
        if (!parsed.ok || !isObject(parsed.value)) {
          throw invalidResponse(status, requestId, "corpo de sucesso não é o envelope JSON da API");
        }
        return parsed.value;
      }

      const error = buildError(status, resHeaders, text, requestId);
      if (RETRY_STATUSES.has(status) && attempt < maxRetries) {
        await this.#sleep(retryDelayMs(attempt, parseRetryAfter(resHeaders.get("retry-after"))), signal);
        continue;
      }
      throw error;
    }
  }

  /** Chamada cujo resultado é `data` do envelope. */
  async data<T>(spec: RequestSpec, options?: RequestOptions): Promise<T> {
    const envelope = await this.request(spec, options);
    return envelope["data"] as T;
  }

  /** Chamada paginada: `data` (lista) + `pagination` → {@link Page}. */
  async page<T>(spec: RequestSpec, options?: RequestOptions): Promise<Page<T>> {
    const envelope = await this.request(spec, options);
    const items = Array.isArray(envelope["data"]) ? (envelope["data"] as T[]) : [];
    const p = isObject(envelope["pagination"]) ? envelope["pagination"] : {};
    const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
    return {
      items,
      page: num(p["page"], 1),
      pageSize: num(p["page_size"], items.length),
      total: num(p["total"], items.length),
      pages: num(p["pages"], 1),
    };
  }

  async #attempt(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeout: number,
    signal: AbortSignal | undefined,
  ): Promise<{ status: number; headers: FetchResponseLike["headers"]; text: string }> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new TimeoutSignal());
    }, timeout);
    try {
      const init: Parameters<FetchLike>[1] = { method, headers, signal: controller.signal };
      if (body !== undefined) init.body = body;
      const res = await this.#fetch(url, init);
      const text = await res.text(); // o timeout cobre também a leitura do corpo
      return { status: res.status, headers: res.headers, text };
    } catch (err) {
      if (timedOut) throw new TimeoutSignal();
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

/** Marca interna de tempo esgotado. */
class TimeoutSignal extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutSignal";
  }
}

function describeCause(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return `${err.message}: ${cause.message}`;
    if (cause && typeof cause === "object" && "code" in cause) {
      return `${err.message}: ${String((cause as { code: unknown }).code)}`;
    }
    return err.message || err.name;
  }
  return String(err);
}

/** Percorre todas as páginas de uma listagem, preguiçosamente. */
export async function* paginate<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  for (let page = 1; ; page++) {
    const current = await fetchPage(page);
    yield* current.items;
    if (current.items.length === 0 || page >= current.pages) return;
  }
}
