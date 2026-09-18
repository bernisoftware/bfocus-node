import { encodeSegment, paginate, pick } from "../core.js";
import type { RequestOptions, Transport } from "../core.js";
import type {
  Page,
  ReleaseNote,
  ReleaseNoteListAllParams,
  ReleaseNoteListParams,
  ReleaseNoteUpsertParams,
} from "../types.js";

const RELEASE_NOTE_FIELDS = {
  title: "title",
  descriptionHtml: "description_html",
  descriptionMarkdown: "description_markdown",
  audience: "audience",
  requireAckInternal: "require_ack_internal",
  requireAckExternal: "require_ack_external",
  publish: "publish",
};

const notesPath = (productSlug: string) => `/products/${encodeSegment(productSlug, "productSlug")}/release-notes`;
const notePath = (productSlug: string, version: string) =>
  `${notesPath(productSlug)}/${encodeSegment(version, "version")}`;

/** Release notes por produto — `bf.releaseNotes`. */
export class ReleaseNotes {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Lista as release notes do produto (uma página). `GET /products/{slug}/release-notes` */
  list(productSlug: string, params: ReleaseNoteListParams = {}, options?: RequestOptions): Promise<Page<ReleaseNote>> {
    return this.#t.page(
      {
        method: "GET",
        path: notesPath(productSlug),
        query: { published: params.published, page: params.page, page_size: params.pageSize },
      },
      options,
    );
  }

  /** Percorre TODAS as release notes do produto, página a página. */
  listAll(
    productSlug: string,
    params: ReleaseNoteListAllParams = {},
    options?: RequestOptions,
  ): AsyncIterableIterator<ReleaseNote> {
    const { pageSize = 100, ...filters } = params;
    notesPath(productSlug); // valida já, não só na primeira iteração
    return paginate((page) => this.list(productSlug, { ...filters, page, pageSize }, options));
  }

  /** Busca a release note de uma versão (`X.Y.Z`, aceita `v` na frente). */
  get(productSlug: string, version: string, options?: RequestOptions): Promise<ReleaseNote> {
    return this.#t.data({ method: "GET", path: notePath(productSlug, version) }, options);
  }

  /**
   * Cria ou atualiza a release note de uma versão; com `publish: true`, publica em seguida
   * (ideal no CI). `PUT /products/{slug}/release-notes/{version}`
   */
  upsert(
    productSlug: string,
    version: string,
    params: ReleaseNoteUpsertParams = {},
    options?: RequestOptions,
  ): Promise<ReleaseNote> {
    return this.#t.data(
      { method: "PUT", path: notePath(productSlug, version), body: pick(params, RELEASE_NOTE_FIELDS) },
      options,
    );
  }

  /** Publica a release note. `POST /products/{slug}/release-notes/{version}/publish` */
  publish(productSlug: string, version: string, options?: RequestOptions): Promise<ReleaseNote> {
    return this.#t.data({ method: "POST", path: `${notePath(productSlug, version)}/publish` }, options);
  }
}
