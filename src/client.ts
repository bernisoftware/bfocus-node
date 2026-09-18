import { DEFAULT_BASE_URL, Transport, defaultSleep } from "./core.js";
import type { FetchLike, SleepFn } from "./core.js";
import { AiAgents } from "./resources/aiAgents.js";
import { Customers } from "./resources/customers.js";
import { Kb } from "./resources/kb.js";
import { Products } from "./resources/products.js";
import { ReleaseNotes } from "./resources/releaseNotes.js";

/** Opções do cliente. */
export interface BfocusOptions {
  /** Chave de API (Integrações → Chaves de API). Obrigatória. */
  apiKey: string;
  /** URL base, sem barra final. Padrão: `https://api.bfocus.com.br`. Dev: `http://localhost:8000`. */
  baseUrl?: string;
  /** Tempo máximo POR TENTATIVA, em milissegundos. Padrão: 30000. */
  timeout?: number;
  /** Novas tentativas além da primeira (rede, 429, 502, 503, 504). Padrão: 2. `0` desliga. */
  maxRetries?: number;
  /** Implementação de `fetch`. Padrão: o `fetch` global (Node 18+). */
  fetch?: FetchLike;
  /**
   * Espera entre tentativas. Padrão: `setTimeout`. Substitua em testes para não dormir
   * (ex.: `sleep: async () => {}`).
   */
  sleep?: SleepFn;
}

/** Opções do construtor quando a chave vai como primeiro argumento. */
export type BfocusClientOptions = Omit<BfocusOptions, "apiKey">;

/**
 * Cliente oficial da API pública do bFocus.
 *
 * Construir não faz chamada de rede. Toda chamada devolve o `data` da resposta
 * (desembrulhado) ou lança um `BfocusError`.
 *
 * @example
 * ```ts
 * import { Bfocus } from "@bfocus/sdk";
 *
 * const bf = new Bfocus({ apiKey: process.env.BFOCUS_API_KEY! });
 * await bf.customers.upsert("ERP 1042", { name: "Padaria Estrela" });
 * ```
 */
export class Bfocus {
  /** URL base em uso. */
  readonly baseUrl: string;
  /** Clientes, contatos, produtos vinculados e interações. */
  readonly customers: Customers;
  /** Catálogo de produtos. */
  readonly products: Products;
  /** Release notes por produto. */
  readonly releaseNotes: ReleaseNotes;
  /** Base de conhecimento (artigos + busca). */
  readonly kb: Kb;
  /** Agentes de IA. */
  readonly aiAgents: AiAgents;

  constructor(options: BfocusOptions);
  constructor(apiKey: string, options?: BfocusClientOptions);
  constructor(apiKeyOrOptions: string | BfocusOptions, maybeOptions: BfocusClientOptions = {}) {
    const options: BfocusOptions =
      typeof apiKeyOrOptions === "string"
        ? { ...maybeOptions, apiKey: apiKeyOrOptions }
        : { ...(apiKeyOrOptions ?? ({} as BfocusOptions)) };

    if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
      throw new TypeError("bFocus: `apiKey` é obrigatória (crie em Integrações → Chaves de API).");
    }
    const timeout = options.timeout ?? 30_000;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError("bFocus: `timeout` deve ser um número positivo de milissegundos.");
    }
    const maxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new RangeError("bFocus: `maxRetries` deve ser um inteiro ≥ 0.");
    }
    const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (typeof fetchImpl !== "function") {
      throw new TypeError("bFocus: `fetch` indisponível. Use Node 18+ ou passe `fetch` nas opções.");
    }

    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const transport = new Transport({
      apiKey: options.apiKey,
      baseUrl: this.baseUrl,
      timeout,
      maxRetries,
      fetch: options.fetch ? fetchImpl : (url, init) => fetchImpl(url, init),
      sleep: options.sleep ?? defaultSleep,
    });

    this.customers = new Customers(transport);
    this.products = new Products(transport);
    this.releaseNotes = new ReleaseNotes(transport);
    this.kb = new Kb(transport);
    this.aiAgents = new AiAgents(transport);
  }
}
