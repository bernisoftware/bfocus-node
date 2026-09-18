import { encodeArticleId, paginate, pick } from "../core.js";
import type { RequestOptions, Transport } from "../core.js";
import type {
  Deleted,
  KbArticle,
  KbArticleBatchItem,
  KbArticleListAllParams,
  KbArticleListParams,
  KbArticleSummary,
  KbArticleUpsertParams,
  KbBatchResult,
  KbSearchHit,
  KbSearchParams,
  Page,
} from "../types.js";

/** Máximo de artigos por requisição de lote aceito pela API. */
export const KB_BATCH_SIZE = 100;

const ARTICLE_FIELDS = {
  title: "title",
  bodyHtml: "body_html",
  bodyMarkdown: "body_markdown",
  product: "product",
  status: "status",
};

const articlePath = (externalId: string) => `/kb/articles/${encodeArticleId(externalId)}`;

/** Artigos da base de conhecimento — `bf.kb.articles`. */
export class KbArticles {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Lista artigos (uma página; sem `body_html`). `GET /kb/articles` */
  list(params: KbArticleListParams = {}, options?: RequestOptions): Promise<Page<KbArticleSummary>> {
    return this.#t.page(
      {
        method: "GET",
        path: "/kb/articles",
        query: {
          product: params.product,
          status: params.status,
          q: params.q,
          updated_since: params.updatedSince,
          page: params.page,
          page_size: params.pageSize,
        },
      },
      options,
    );
  }

  /** Percorre TODOS os artigos, página a página. */
  listAll(params: KbArticleListAllParams = {}, options?: RequestOptions): AsyncIterableIterator<KbArticleSummary> {
    const { pageSize = 100, ...filters } = params;
    return paginate((page) => this.list({ ...filters, page, pageSize }, options));
  }

  /** Busca um artigo (com `body_html`). `GET /kb/articles/{external_id}` */
  get(externalId: string, options?: RequestOptions): Promise<KbArticle> {
    return this.#t.data({ method: "GET", path: articlePath(externalId) }, options);
  }

  /**
   * Cria ou atualiza um artigo pelo `external_id` do seu sistema (sem `/`; use `:`).
   * Só os campos informados mudam; `product: null` torna o artigo global.
   * `PUT /kb/articles/{external_id}`
   */
  upsert(externalId: string, params: KbArticleUpsertParams = {}, options?: RequestOptions): Promise<KbArticle> {
    return this.#t.data(
      { method: "PUT", path: articlePath(externalId), body: pick(params, ARTICLE_FIELDS) },
      options,
    );
  }

  /**
   * Cria/atualiza QUALQUER quantidade de artigos. A SDK divide em lotes de 100 (limite da
   * API), envia em sequência e devolve UM resultado agregado: `results` na ordem enviada e
   * contadores somados. Falha de um artigo não derruba os outros (veja `results[i].ok`).
   *
   * Cada lote é uma escrita com a própria `Idempotency-Key`. Com `options.idempotencyKey`, o 1º
   * lote usa a chave como veio e os seguintes `<chave>:2`, `<chave>:3`, …; sem ela, cada lote gera
   * a sua. Lista vazia devolve o resultado zerado sem requisição.
   *
   * `POST /kb/articles/batch`
   */
  async batchUpsert(articles: readonly KbArticleBatchItem[], options: RequestOptions = {}): Promise<KbBatchResult> {
    if (!Array.isArray(articles)) throw new TypeError("bFocus: `articles` deve ser uma lista.");
    const items = articles.map((article, i) => {
      if (!article || typeof article.externalId !== "string" || article.externalId === "") {
        throw new TypeError(`bFocus: articles[${i}].externalId é obrigatório.`);
      }
      encodeArticleId(article.externalId, `articles[${i}].externalId`);
      return { external_id: article.externalId, ...pick(article, ARTICLE_FIELDS) };
    });

    const total: KbBatchResult = { results: [], created: 0, updated: 0, unchanged: 0, failed: 0 };
    const chunks = Math.ceil(items.length / KB_BATCH_SIZE);
    for (let n = 0; n < chunks; n++) {
      const chunk = items.slice(n * KB_BATCH_SIZE, (n + 1) * KB_BATCH_SIZE);
      const chunkOptions: RequestOptions =
        options.idempotencyKey !== undefined && n > 0
          ? { ...options, idempotencyKey: `${options.idempotencyKey}:${n + 1}` }
          : options;
      const part = await this.#t.data<KbBatchResult>(
        { method: "POST", path: "/kb/articles/batch", body: { articles: chunk } },
        chunkOptions,
      );
      if (chunks === 1) return part;
      total.results.push(...(part.results ?? []));
      total.created += part.created ?? 0;
      total.updated += part.updated ?? 0;
      total.unchanged += part.unchanged ?? 0;
      total.failed += part.failed ?? 0;
    }
    return total;
  }

  /** Publica o artigo (passa a alimentar o agente de IA). `POST /kb/articles/{external_id}/publish` */
  publish(externalId: string, options?: RequestOptions): Promise<KbArticle> {
    return this.#t.data({ method: "POST", path: `${articlePath(externalId)}/publish` }, options);
  }

  /** Volta o artigo para rascunho. `POST /kb/articles/{external_id}/unpublish` */
  unpublish(externalId: string, options?: RequestOptions): Promise<KbArticle> {
    return this.#t.data({ method: "POST", path: `${articlePath(externalId)}/unpublish` }, options);
  }

  /** Exclui o artigo. `DELETE /kb/articles/{external_id}` */
  delete(externalId: string, options?: RequestOptions): Promise<Deleted> {
    return this.#t.data({ method: "DELETE", path: articlePath(externalId) }, options);
  }
}

/** Base de conhecimento — `bf.kb`. */
export class Kb {
  readonly #t: Transport;
  /** Artigos. */
  readonly articles: KbArticles;

  constructor(transport: Transport) {
    this.#t = transport;
    this.articles = new KbArticles(transport);
  }

  /** Busca semântica/textual nos artigos publicados. `GET /kb/search` */
  search(q: string, params: KbSearchParams = {}, options?: RequestOptions): Promise<KbSearchHit[]> {
    return this.#t.data(
      { method: "GET", path: "/kb/search", query: { q, product: params.product, limit: params.limit } },
      options,
    );
  }
}
