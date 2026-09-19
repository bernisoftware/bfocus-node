/** Testes unitários da SDK (além da conformidade): lotes, paginação, rede, versão, bordas. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  BATCH_MAX,
  Bfocus,
  BfocusError,
  DEFAULT_BASE_URL,
  NetworkError,
  RateLimitError,
  ServerError,
  VERSION,
  signWidgetIdentity,
  signWidgetIdentityV2,
} from "@bfocus/sdk";
import type { CustomerBatchItem, FetchLike, KbArticleBatchItem, PersonBatchItem } from "@bfocus/sdk";
import { closedPort, startServer } from "./helpers/server.js";
import type { Recorded, Reply, TestServer } from "./helpers/server.js";

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const P = "/api/v1/integration";
const noSleep = async () => {};

/** Resposta de sucesso no envelope da API. */
const ok = (data: unknown, status = 200): Reply => ({ status, body: { code: status, data, message: "ok" } });
const pageOk = (items: unknown[], page: number, pageSize: number, total: number): Reply => ({
  status: 200,
  body: {
    code: 200,
    data: items,
    message: "ok",
    pagination: { page, page_size: pageSize, total, pages: Math.ceil(total / pageSize) },
  },
});
const query = (r: Recorded) => Object.fromEntries(r.queryPairs);

/** Espera a chamada falhar com BfocusError e o devolve. */
async function failure(pending: Promise<unknown>): Promise<BfocusError> {
  try {
    await pending;
  } catch (e) {
    assert.ok(e instanceof BfocusError, `esperava BfocusError, veio ${String(e)}`);
    return e;
  }
  return assert.fail("a chamada devia ter falhado");
}

let server: TestServer;
let bf: Bfocus;
before(async () => {
  server = await startServer();
});
after(() => server.close());
beforeEach(() => {
  server.reset();
  bf = new Bfocus({ apiKey: "bf_live_test", baseUrl: server.url, sleep: noSleep });
});

describe("versão", () => {
  it("VERSION == package.json == src/version.ts (o que o release-sdks.sh bumpa)", () => {
    assert.equal(VERSION, PKG.version);
    const src = readFileSync(new URL("../src/version.ts", import.meta.url), "utf8");
    const matches = [...src.matchAll(/VERSION = '([^']+)'/g)];
    assert.equal(matches.length, 1, "o regex do release precisa casar exatamente uma vez");
    assert.equal(matches[0]![1], PKG.version);
  });

  it("vai no X-Bfocus-Client e no User-Agent", async () => {
    server.setHandler(() => ok([]));
    await bf.products.list();
    assert.equal(server.requests[0]!.headers["x-bfocus-client"], `bfocus-node/${VERSION}`);
    assert.equal(server.requests[0]!.headers["user-agent"], `bfocus-node/${VERSION}`);
  });
});

describe("construtor", () => {
  it("chave vazia é erro de argumento imediato (não BfocusError)", () => {
    for (const bad of ["", "   "]) {
      assert.throws(() => new Bfocus(bad), (e: unknown) => e instanceof TypeError && !(e instanceof BfocusError));
      assert.throws(() => new Bfocus({ apiKey: bad }), TypeError);
    }
    assert.throws(() => new Bfocus(undefined as unknown as string), TypeError);
  });

  it("aceita chave posicional ou objeto; padrões e barra final", () => {
    assert.equal(new Bfocus("k").baseUrl, DEFAULT_BASE_URL);
    assert.equal(DEFAULT_BASE_URL, "https://api.bfocus.com.br");
    assert.equal(new Bfocus("k", { baseUrl: "http://localhost:8000/" }).baseUrl, "http://localhost:8000");
    assert.equal(new Bfocus({ apiKey: "k", baseUrl: "http://x//" }).baseUrl, "http://x");
    assert.throws(() => new Bfocus({ apiKey: "k", maxRetries: -1 }), RangeError);
    assert.throws(() => new Bfocus({ apiKey: "k", timeout: 0 }), RangeError);
  });

  it("não faz chamada de rede ao construir", () => {
    const fetch: FetchLike = () => {
      throw new Error("rede no construtor!");
    };
    const client = new Bfocus({ apiKey: "k", fetch });
    assert.ok(client.customers && client.kb.articles && client.aiAgents);
  });

  it("não expõe a chave em propriedades enumeráveis", () => {
    const client = new Bfocus({ apiKey: "bf_live_secreta" });
    assert.ok(!JSON.stringify(client).includes("bf_live_secreta"));
  });
});

describe("caminho, query e corpo", () => {
  it("codifica cada segmento do caminho", async () => {
    server.setHandler(() => ok({}));
    await bf.customers.get("ERP 1042");
    await bf.customers.get("a/b");
    await bf.customers.get("...");
    await bf.customers.contacts.delete("x y", "it's (1)*!");
    assert.deepEqual(
      server.requests.map((r) => r.path),
      [
        `${P}/customers/ERP%201042`,
        `${P}/customers/a%2Fb`,
        `${P}/customers/...`,
        `${P}/customers/x%20y/contacts/it%27s%20%281%29%2A%21`,
      ],
    );
  });

  it("recusa `/` no external_id de artigo sem ir à rede", async () => {
    server.setHandler(() => ok({}));
    assert.throws(() => bf.kb.articles.get("guia/instalacao"), TypeError);
    await assert.rejects(bf.kb.articles.batchUpsert([{ externalId: "a/b", title: "x" }]), TypeError);
    assert.throws(() => bf.customers.get(""), TypeError);
    // "." e ".." seriam resolvidos pelo parser de URL (mesmo como %2E%2E) → outra rota
    assert.throws(() => bf.customers.get(".."), /não é endereçável/);
    assert.throws(() => bf.customers.contacts.delete("C1", "."), TypeError);
    assert.equal(server.requests.length, 0);
  });

  it("query: omite undefined/null, booleanos true/false, Date em UTC com Z", async () => {
    server.setHandler(() => pageOk([], 1, 50, 0));
    await bf.customers.list({ q: undefined, updatedSince: new Date(Date.UTC(2026, 8, 1, 3, 4, 5)) });
    await bf.kb.articles.list({ updatedSince: new Date(Date.UTC(2026, 8, 1, 0, 0, 0, 123)), product: null as never });
    await bf.kb.articles.list({ updatedSince: "2026-09-01T00:00:00-03:00" });
    server.setHandler(() => ok([]));
    await bf.products.list({ includeInactive: false });
    await bf.kb.search("nota fiscal & cia", { limit: 3 });
    assert.deepEqual(server.requests.map(query), [
      { updated_since: "2026-09-01T03:04:05Z" },
      { updated_since: "2026-09-01T00:00:00.123Z" },
      { updated_since: "2026-09-01T00:00:00-03:00" },
      { include_inactive: "false" },
      { q: "nota fiscal & cia", limit: "3" },
    ]);
  });

  it("corpo: undefined é omitido, null vai como null; sem params = {}", async () => {
    server.setHandler(() => ok({}));
    await bf.customers.upsert("C1", { name: undefined, phone: null, customFields: [{ key: "k", value: null }] });
    await bf.customers.upsert("C1");
    await bf.products.upsert("erp", { isActive: false, sortOrder: null });
    await bf.releaseNotes.upsert("erp", "1.0.0", { descriptionMarkdown: "x", requireAckExternal: true });
    await bf.customers.contacts.upsert("C1", "CT", { isPrimary: false });
    assert.deepEqual(
      server.requests.map((r) => r.body),
      [
        { phone: null, custom_fields: [{ key: "k", value: null }] },
        {},
        { is_active: false, sort_order: null },
        { description_markdown: "x", require_ack_external: true },
        { is_primary: false },
      ],
    );
  });

  it("escritas sem corpo não mandam Content-Type; leituras não mandam Idempotency-Key", async () => {
    server.setHandler(() => ok({}));
    await bf.customers.products.attach("C1", "erp");
    await bf.customers.get("C1");
    const [attach, get] = server.requests;
    assert.equal(attach!.rawBody, "");
    assert.equal(attach!.headers["content-type"], undefined);
    assert.match(String(attach!.headers["idempotency-key"]), /^[0-9a-f-]{36}$/);
    assert.equal(get!.headers["idempotency-key"], undefined);
    assert.match(String(get!.headers["x-request-id"]), /^[0-9a-f]{32}$/);
  });

  it("idempotencyKey por chamada é respeitada e cada chamada lógica tem ids próprios", async () => {
    server.setHandler(() => ok({}));
    await bf.kb.articles.publish("a1", { idempotencyKey: "minha-chave" });
    await bf.kb.articles.publish("a1");
    await bf.kb.articles.publish("a1");
    const [a, b, c] = server.requests;
    assert.equal(a!.headers["idempotency-key"], "minha-chave");
    assert.notEqual(b!.headers["idempotency-key"], c!.headers["idempotency-key"]);
    assert.notEqual(b!.headers["x-request-id"], c!.headers["x-request-id"]);
  });
});

describe("kb.articles.batchUpsert", () => {
  const articles = (n: number): KbArticleBatchItem[] =>
    Array.from({ length: n }, (_, i) => ({ externalId: `git:doc-${i}`, title: `Doc ${i}`, bodyMarkdown: "x" }));

  beforeEach(() => {
    server.setHandler((req) => {
      const sent = (req.body as { articles: { external_id: string }[] }).articles;
      return ok({
        results: sent.map((a, i) => ({
          external_id: a.external_id,
          ok: i % 10 !== 9,
          action: i % 10 !== 9 ? "created" : null,
          error: i % 10 !== 9 ? null : "KB_ARTICLE_TITLE_REQUIRED",
          article: null,
        })),
        created: sent.filter((_, i) => i % 10 !== 9).length,
        updated: 0,
        unchanged: 0,
        failed: sent.filter((_, i) => i % 10 === 9).length,
      });
    });
  });

  it("divide em lotes de 100, em ordem, e agrega o resultado", async () => {
    const result = await bf.kb.articles.batchUpsert(articles(250));
    assert.deepEqual(
      server.requests.map((r) => (r.body as { articles: unknown[] }).articles.length),
      [100, 100, 50],
    );
    assert.deepEqual(
      server.requests.flatMap((r) => (r.body as { articles: { external_id: string }[] }).articles.map((a) => a.external_id)),
      articles(250).map((a) => a.externalId),
    );
    assert.equal(result.results.length, 250);
    assert.deepEqual(
      result.results.map((r) => r.external_id),
      articles(250).map((a) => a.externalId),
    );
    assert.equal(result.created, 225);
    assert.equal(result.failed, 25);
    assert.equal(result.updated + result.unchanged, 0);
    // cada lote é uma escrita com a própria Idempotency-Key
    const keys = server.requests.map((r) => r.headers["idempotency-key"]);
    assert.equal(new Set(keys).size, 3);
  });

  it("converte camelCase → snake_case e mantém product: null", async () => {
    await bf.kb.articles.batchUpsert([
      { externalId: "a", title: "T", bodyHtml: "<p>x</p>", product: null, status: "published" },
    ]);
    assert.deepEqual(server.requests[0]!.body, {
      articles: [{ external_id: "a", title: "T", body_html: "<p>x</p>", product: null, status: "published" }],
    });
  });

  it("idempotencyKey do usuário: 1º lote usa a chave como veio; os seguintes <chave>:2, :3…", async () => {
    await bf.kb.articles.batchUpsert(articles(3), { idempotencyKey: "sync-42" });
    assert.equal(server.requests[0]!.headers["idempotency-key"], "sync-42");
    server.reset();
    await bf.kb.articles.batchUpsert(articles(201), { idempotencyKey: "sync-42" });
    assert.deepEqual(
      server.requests.map((r) => r.headers["idempotency-key"]),
      ["sync-42", "sync-42:2", "sync-42:3"],
    );
  });

  it("lista vazia não chama a API; item sem externalId falha antes de qualquer envio", async () => {
    assert.deepEqual(await bf.kb.articles.batchUpsert([]), {
      results: [],
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
    });
    await assert.rejects(
      bf.kb.articles.batchUpsert([...articles(150), { title: "sem id" } as unknown as KbArticleBatchItem]),
      /articles\[150\]\.externalId/,
    );
    assert.equal(server.requests.length, 0);
  });
});

describe("customers.batch / people.batch", () => {
  const customers = (n: number): CustomerBatchItem[] =>
    Array.from({ length: n }, (_, i) => ({ externalId: `erp-${i}`, name: `Cliente ${i}` }));
  const people = (n: number): PersonBatchItem[] =>
    Array.from({ length: n }, (_, i) => ({ customerExternalId: "erp-1", externalId: `app-${i}`, name: `P ${i}` }));
  const echo = (r: Recorded) => {
    const items = (r.body as { items: unknown[] }).items;
    return ok({
      results: items.map((_, index) => ({
        index,
        status: "created",
        external_id: `x${index}`,
        merged_into: null,
        error: null,
        code: null,
      })),
      summary: { created: items.length, updated: 0, unchanged: 0, error: 0 },
    });
  };

  it("BATCH_MAX é 500", () => {
    assert.equal(BATCH_MAX, 500);
  });

  it("501 itens: TypeError em português, sem nenhuma requisição", async () => {
    server.setHandler(echo);
    await assert.rejects(
      bf.customers.batch(customers(501)),
      (e: unknown) =>
        e instanceof TypeError &&
        !(e instanceof BfocusError) &&
        e.message.includes("customers.batch aceita até 500 itens por chamada (recebeu 501); divida em lotes de 500."),
    );
    await assert.rejects(
      bf.people.batch(people(501)),
      (e: unknown) => e instanceof TypeError && e.message.includes("people.batch aceita até 500 itens"),
    );
    assert.equal(server.requests.length, 0);
  });

  it("500 itens: UMA requisição com os 500 (a SDK não divide)", async () => {
    server.setHandler(echo);
    const c = await bf.customers.batch(customers(500), { idempotencyKey: "carga-1" });
    const p = await bf.people.batch(people(500));
    assert.equal(server.requests.length, 2);
    assert.equal(server.requests[0]!.path, `${P}/customers/batch`);
    assert.equal((server.requests[0]!.body as { items: unknown[] }).items.length, 500);
    assert.equal(server.requests[0]!.headers["idempotency-key"], "carga-1");
    assert.equal(server.requests[1]!.path, `${P}/people/batch`);
    assert.equal((server.requests[1]!.body as { items: unknown[] }).items.length, 500);
    assert.equal(c.summary.created, 500);
    assert.equal(p.results[499]!.index, 499);
  });

  it("serializa como o upsert (só o que veio; null vai) e people vira {customer_external_id, person}", async () => {
    server.setHandler(echo);
    await bf.customers.batch([{ externalId: "erp-1", name: "A", document: null, email: undefined }]);
    assert.deepEqual(server.requests[0]!.body, { items: [{ external_id: "erp-1", name: "A", document: null }] });
    await bf.people.batch([
      { customerExternalId: "erp-1", externalId: "app-1", isPrimary: true, extraPhones: null, phone: undefined },
    ]);
    assert.deepEqual(server.requests[1]!.body, {
      items: [{ customer_external_id: "erp-1", person: { external_id: "app-1", is_primary: true, extra_phones: null } }],
    });
  });

  it("lista vazia não chama a API; item sem id falha antes de qualquer envio", async () => {
    const empty = { results: [], summary: { created: 0, updated: 0, unchanged: 0, error: 0 } };
    assert.deepEqual(await bf.customers.batch([]), empty);
    assert.deepEqual(await bf.people.batch([]), empty);
    await assert.rejects(
      bf.customers.batch([...customers(3), { name: "sem id" } as unknown as CustomerBatchItem]),
      /items\[3\]\.externalId/,
    );
    await assert.rejects(
      bf.people.batch([{ externalId: "app-1" } as unknown as PersonBatchItem]),
      /items\[0\]\.customerExternalId/,
    );
    assert.equal(server.requests.length, 0);
  });
});

describe("people e identificadores", () => {
  it("upsert manda {person: {...}} só com o que veio; codifica os segmentos", async () => {
    server.setHandler(() => ok({ status: "unchanged" }));
    await bf.people.upsert("ERP 1042", "app 7");
    assert.equal(server.requests[0]!.path, `${P}/customers/ERP%201042/people/app%207`);
    assert.deepEqual(server.requests[0]!.body, { person: {} });
  });

  it("identifiers.add: corpo só com label (inclusive null); sem label, sem corpo", async () => {
    server.setHandler(() => ok({ external_id: "x", identifiers: [] }));
    await bf.customers.identifiers.add("ERP 1042", "crm-88", { label: null });
    await bf.people.identifiers.add("app-1", "crm-p5");
    assert.equal(server.requests[0]!.path, `${P}/customers/ERP%201042/identifiers/crm-88`);
    assert.deepEqual(server.requests[0]!.body, { label: null });
    assert.equal(server.requests[1]!.body, null);
    assert.equal(server.requests[1]!.headers["content-type"], undefined);
  });
});

describe("listAll", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `id-${i}` }));
  const paged = (req: Recorded) => {
    const page = Number(query(req)["page"]);
    const size = Number(query(req)["page_size"]);
    return pageOk(items.slice((page - 1) * size, page * size), page, size, items.length);
  };

  it("percorre todas as páginas e para na última", async () => {
    server.setHandler(paged);
    const got: unknown[] = [];
    for await (const a of bf.kb.articles.listAll({ status: "published", pageSize: 2 })) got.push(a);
    assert.deepEqual(got, items);
    assert.deepEqual(server.requests.map(query), [
      { status: "published", page: "1", page_size: "2" },
      { status: "published", page: "2", page_size: "2" },
      { status: "published", page: "3", page_size: "2" },
    ]);
  });

  it("é preguiçoso (nada vai à rede antes de iterar) e usa page_size 100 por padrão", async () => {
    server.setHandler(paged);
    const it = bf.customers.listAll({ q: "padaria" });
    assert.equal(server.requests.length, 0);
    const first = await it.next();
    assert.deepEqual(first.value, items[0]);
    assert.deepEqual(query(server.requests[0]!), { q: "padaria", page: "1", page_size: "100" });
  });

  it("interações e release notes também paginam; lista vazia termina", async () => {
    server.setHandler(paged);
    const interactions: unknown[] = [];
    for await (const i of bf.customers.interactions.listAll("C1", { pageSize: 4 })) interactions.push(i);
    assert.equal(interactions.length, 5);
    assert.equal(server.requests.length, 2);
    server.reset();
    server.setHandler(() => pageOk([], 1, 100, 0));
    const notes: unknown[] = [];
    for await (const n of bf.releaseNotes.listAll("erp", { published: true })) notes.push(n);
    assert.deepEqual(notes, []);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0]!.path, `${P}/products/erp/release-notes`);
  });
});

describe("novas tentativas e erros de rede", () => {
  it("NetworkError com o servidor fora do ar, depois de maxRetries novas tentativas", async () => {
    const port = await closedPort();
    const sleeps: number[] = [];
    const client = new Bfocus({ apiKey: "k", baseUrl: `http://127.0.0.1:${port}`, sleep: async (ms) => void sleeps.push(ms) });
    const err = await client.customers.get("C1").then(
      () => assert.fail("devia falhar"),
      (e: unknown) => e,
    );
    assert.ok(err instanceof NetworkError);
    assert.ok(err instanceof BfocusError);
    assert.equal(err.status, 0);
    assert.equal(err.code, "NETWORK_ERROR");
    assert.match(err.requestId ?? "", /^[0-9a-f]{32}$/);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps[0]! >= 500 && sleeps[0]! <= 625, `backoff 1: ${sleeps[0]}`);
    assert.ok(sleeps[1]! >= 1000 && sleeps[1]! <= 1250, `backoff 2: ${sleeps[1]}`);

    const noRetry = new Bfocus({ apiKey: "k", baseUrl: `http://127.0.0.1:${port}`, maxRetries: 0, sleep: async () => assert.fail("não devia esperar") });
    await assert.rejects(noRetry.products.list(), NetworkError);
  });

  it("timeout por tentativa vira NetworkError e repete o mesmo X-Request-Id", async () => {
    server.setHandler(() => "hang");
    const client = new Bfocus({ apiKey: "k", baseUrl: server.url, timeout: 100, maxRetries: 1, sleep: noSleep });
    await assert.rejects(client.customers.get("C1"), (e: unknown) => {
      assert.ok(e instanceof NetworkError);
      assert.match(e.message, /tempo esgotado após 100 ms/);
      return true;
    });
    assert.equal(server.requests.length, 2);
    assert.equal(server.requests[0]!.headers["x-request-id"], server.requests[1]!.headers["x-request-id"]);
  });

  it("Retry-After é respeitado com teto de 60 s; 500 não é repetido", async () => {
    const sleeps: number[] = [];
    const client = new Bfocus({ apiKey: "k", baseUrl: server.url, sleep: async (ms) => void sleeps.push(ms) });
    const replies: Reply[] = [
      { status: 503, headers: { "Retry-After": "120" }, body: "busy" },
      { status: 429, headers: { "Retry-After": "2" }, body: { error: "RATE_LIMITED" } },
      ok({ id: "1" }),
    ];
    server.setHandler(() => replies.shift()!);
    assert.deepEqual(await client.customers.get("C1"), { id: "1" });
    assert.deepEqual(sleeps, [60_000, 2_000]);

    server.reset();
    server.setHandler(() => ({ status: 500, body: { error: "INTERNAL_ERROR" } }));
    await assert.rejects(client.customers.get("C1"), ServerError);
    assert.equal(server.requests.length, 1);
  });

  it("429 esgotado vira RateLimitError com retryAfter", async () => {
    server.setHandler(() => ({ status: 429, headers: { "Retry-After": "7" }, body: { error: "RATE_LIMITED" } }));
    const err = await bf.products.get("erp").catch((e: unknown) => e);
    assert.ok(err instanceof RateLimitError);
    assert.equal(err.retryAfter, 7);
    assert.equal(server.requests.length, 3);
  });

  it("cancelamento por quem chama propaga o AbortError, sem nova tentativa", async () => {
    server.setHandler(() => "hang");
    const controller = new AbortController();
    const pending = bf.customers.get("C1", { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending, (e: unknown) => !(e instanceof BfocusError) && (e as Error).name === "AbortError");
    assert.equal(server.requests.length, 1);
  });
});

describe("mapeamento de erros", () => {
  it("code vem de error → message → HTTP_<status>; requestId do corpo → header → enviado", async () => {
    const replies: Reply[] = [
      { status: 400, body: { message: "SOMETHING_ODD" } },
      { status: 418, headers: { "X-Request-Id": "rid-header" }, body: "<html>teapot</html>" },
      { status: 404, body: {} },
    ];
    server.setHandler(() => replies.shift()!);
    const e1 = await failure(bf.customers.get("C1"));
    assert.equal(e1.constructor, BfocusError);
    assert.equal(e1.code, "SOMETHING_ODD");
    const e2 = await failure(bf.customers.get("C1"));
    assert.equal(e2.code, "HTTP_418");
    assert.equal(e2.requestId, "rid-header");
    const e3 = await failure(bf.customers.get("C1"));
    assert.equal(e3.code, "HTTP_404");
    assert.equal(e3.requestId, server.requests[2]!.headers["x-request-id"]);
    assert.deepEqual(e3.validation, {});
  });

  it("mensagem legível com escopo e validação; toJSON para logs", async () => {
    server.setHandler(() => ({
      status: 403,
      headers: { "X-Required-Scope": "kb:write" },
      body: { error: "INTEGRATION_SCOPE_MISSING", request_id: "r1" },
    }));
    const err = await failure(bf.kb.articles.delete("a"));
    assert.equal(err.name, "PermissionDeniedError");
    assert.equal(err.message, "INTEGRATION_SCOPE_MISSING (HTTP 403, escopo exigido: kb:write, request_id: r1)");
    assert.equal(JSON.parse(JSON.stringify(err)).requiredScope, "kb:write");
  });

  it("2xx fora do envelope JSON vira INVALID_RESPONSE", async () => {
    server.setHandler(() => ({ status: 200, body: "<html>proxy</html>" }));
    await assert.rejects(bf.customers.get("C1"), (e: unknown) => e instanceof BfocusError && e.code === "INVALID_RESPONSE");
  });

  it("campos desconhecidos na resposta são preservados", async () => {
    server.setHandler(() => ok({ id: "1", campo_novo: { a: 1 } }));
    const c = await bf.customers.get("C1");
    assert.deepEqual((c as unknown as Record<string, unknown>)["campo_novo"], { a: 1 });
  });
});

describe("signWidgetIdentity", () => {
  it("HMAC-SHA256 hex minúsculo de v1:<user>:<customer>", () => {
    assert.equal(
      signWidgetIdentity("bf_whs_x", "USR-1", "ACME-1"),
      "9a15d2527b855a048094ea7826c3b0f16ae5db3035ac3537324d45007ef15141",
    );
    assert.throws(() => signWidgetIdentity("", "u", "c"), TypeError);
  });
});

describe("signWidgetIdentityV2", () => {
  it("formato v2.<ts>.<hex> com o instante fixo (número = segundos unix)", () => {
    assert.equal(
      signWidgetIdentityV2("bf_whs_x", "USR-1", "ACME-1", { now: 1789000000 }),
      "v2.1789000000.bfbf2a0390fbb9d65f268899acce2b4d7a2606ba13bb25b453ff3a7971fbd7be",
    );
    assert.match(signWidgetIdentityV2("s", "u", "c", { now: 1789000000.9 }), /^v2\.1789000000\.[0-9a-f]{64}$/);
  });

  it("sem instante, ts fica a ±5 s de agora", () => {
    const [prefix, ts, hex] = signWidgetIdentityV2("bf_whs_x", "app-77", "erp-1042").split(".");
    assert.equal(prefix, "v2");
    assert.match(hex!, /^[0-9a-f]{64}$/);
    assert.ok(Math.abs(Number(ts) - Date.now() / 1000) <= 5, `ts fora da janela: ${ts}`);
  });

  it("recusa ':' no usuário (o cliente pode ter), vazios e instante negativo", () => {
    assert.throws(() => signWidgetIdentityV2("s", "erp:77", "c"), (e: unknown) => e instanceof TypeError && /:/.test(e.message));
    assert.doesNotThrow(() => signWidgetIdentityV2("s", "app-77", "erp:1042"));
    assert.throws(() => signWidgetIdentityV2("", "u", "c"), TypeError);
    assert.throws(() => signWidgetIdentityV2("s", "", "c"), TypeError);
    assert.throws(() => signWidgetIdentityV2("s", "u", ""), TypeError);
    assert.throws(() => signWidgetIdentityV2("s", "u", "c", { now: -1 }), TypeError);
    assert.throws(() => signWidgetIdentityV2("s", "u", "c", { now: new Date(Number.NaN) }), TypeError);
  });

  it("não mudou a v1", () => {
    assert.equal(
      signWidgetIdentity("bf_whs_x", "USR-1", "ACME-1"),
      "9a15d2527b855a048094ea7826c3b0f16ae5db3035ac3537324d45007ef15141",
    );
  });
});
