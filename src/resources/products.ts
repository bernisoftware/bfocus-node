import { encodeSegment, pick } from "../core.js";
import type { RequestOptions, Transport } from "../core.js";
import type { Product, ProductListParams, ProductUpsertParams } from "../types.js";

const PRODUCT_FIELDS = {
  name: "name",
  description: "description",
  color: "color",
  icon: "icon",
  isActive: "is_active",
  sortOrder: "sort_order",
};

const productPath = (slug: string) => `/products/${encodeSegment(slug, "slug")}`;

/** Catálogo de produtos — `bf.products`. */
export class Products {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Lista os produtos (arquivados só com `includeInactive`). `GET /products` */
  list(params: ProductListParams = {}, options?: RequestOptions): Promise<Product[]> {
    return this.#t.data(
      { method: "GET", path: "/products", query: { include_inactive: params.includeInactive } },
      options,
    );
  }

  /** Busca um produto pelo slug. `GET /products/{slug}` */
  get(slug: string, options?: RequestOptions): Promise<Product> {
    return this.#t.data({ method: "GET", path: productPath(slug) }, options);
  }

  /**
   * Cria ou atualiza um produto pelo slug. Só os campos informados mudam; `null` limpa.
   * `PUT /products/{slug}`
   */
  upsert(slug: string, params: ProductUpsertParams = {}, options?: RequestOptions): Promise<Product> {
    return this.#t.data({ method: "PUT", path: productPath(slug), body: pick(params, PRODUCT_FIELDS) }, options);
  }

  /** Arquiva o produto (sai das listas; o histórico fica). `DELETE /products/{slug}` */
  archive(slug: string, options?: RequestOptions): Promise<Product> {
    return this.#t.data({ method: "DELETE", path: productPath(slug) }, options);
  }
}
