/**
 * Suíte de conformidade (BRIEF §7): roda TODOS os casos de clients/conformance/cases.json
 * contra um servidor node:http local que confere cada troca.
 *
 * Fonte dos casos: no monorepo, `clients/conformance/cases.json` (e a cópia em
 * test/conformance/cases.json precisa ser idêntica — `npm run sync:conformance`); no espelho
 * público, só a cópia existe.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
  AuthenticationError,
  Bfocus,
  BfocusError,
  ConflictError,
  NetworkError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  VERSION,
  ValidationError,
  signWidgetIdentity,
  signWidgetIdentityV2,
} from "@bfocus/sdk";
import type { Page } from "@bfocus/sdk";
import { startServer } from "./helpers/server.js";
import type { Recorded, TestServer } from "./helpers/server.js";

// ── Casos ────────────────────────────────────────────────────────────────────

interface ExchangeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}
interface Exchange {
  /** true = nova tentativa da troca anterior (mesmos ids); false = chamada lógica nova (ids novos). */
  retry: boolean;
  request: ExchangeRequest;
  response: { status: number; headers: Record<string, string>; body: unknown };
}
interface Case {
  id: string;
  op: string;
  args: Record<string, any>;
  exchanges: Exchange[];
  expect: { result?: unknown; error?: Record<string, any> };
}
interface Cases {
  api_key: string;
  sdk_excluded_ops: string[];
  sdk_helper_ops?: Record<string, string>;
  cases: Case[];
  signatures: { secret: string; user_external_id: string; customer_external_id: string; expected: string }[];
  signatures_v2: {
    secret: string;
    user_external_id: string;
    customer_external_id: string;
    timestamp: number;
    expected: string;
  }[];
}

const MONOREPO_CASES = new URL("../../conformance/cases.json", import.meta.url);
const VENDORED_CASES = new URL("../test/conformance/cases.json", import.meta.url);
const PUBLIC_SPEC = new URL("../../../api/openapi/public.json", import.meta.url);

function loadCases(): Cases {
  if (existsSync(MONOREPO_CASES)) {
    const source = readFileSync(MONOREPO_CASES, "utf8");
    assert.ok(existsSync(VENDORED_CASES), "falta test/conformance/cases.json — rode `python3 clients/conformance/generate.py`");
    assert.equal(
      readFileSync(VENDORED_CASES, "utf8"),
      source,
      "test/conformance/cases.json está desatualizado — rode `python3 clients/conformance/generate.py`",
    );
    return JSON.parse(source) as Cases;
  }
  assert.ok(existsSync(VENDORED_CASES), "cases.json não encontrado");
  return JSON.parse(readFileSync(VENDORED_CASES, "utf8")) as Cases;
}

const CASES = loadCases();

// ── Tabela op → chamada da SDK ───────────────────────────────────────────────

type Args = Record<string, any>;
const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** `args` neutros (snake_case) → objeto de parâmetros camelCase, sem os posicionais. */
function params(args: Args, ...positional: string[]): any {
  const out: Args = {};
  for (const [key, value] of Object.entries(args)) {
    if (!positional.includes(key)) out[camel(key)] = value;
  }
  return out;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/** `Page` → JSON neutro do cases.json. */
const pageJson = (p: Page<unknown>) => ({
  items: p.items,
  page: p.page,
  page_size: p.pageSize,
  total: p.total,
  pages: p.pages,
});

const OPS: Record<string, (bf: Bfocus, a: Args) => Promise<unknown>> = {
  "customers.upsert": (bf, a) => bf.customers.upsert(a.external_id, params(a, "external_id")),
  "customers.get": (bf, a) => bf.customers.get(a.external_id),
  "customers.list": async (bf, a) => pageJson(await bf.customers.list(params(a))),
  "customers.list_all": (bf, a) => collect(bf.customers.listAll(params(a))),
  "customers.delete": (bf, a) => bf.customers.delete(a.external_id),
  "customers.contacts.list": (bf, a) => bf.customers.contacts.list(a.external_id),
  "customers.contacts.upsert": (bf, a) =>
    bf.customers.contacts.upsert(
      a.external_id,
      a.contact_external_id,
      params(a, "external_id", "contact_external_id"),
    ),
  "customers.contacts.delete": (bf, a) => bf.customers.contacts.delete(a.external_id, a.contact_external_id),
  "customers.products.list": (bf, a) => bf.customers.products.list(a.external_id),
  "customers.products.attach": (bf, a) => bf.customers.products.attach(a.external_id, a.product_slug),
  "customers.products.detach": (bf, a) => bf.customers.products.detach(a.external_id, a.product_slug),
  "customers.interactions.list": async (bf, a) =>
    pageJson(await bf.customers.interactions.list(a.external_id, params(a, "external_id"))),
  "customers.interactions.list_all": (bf, a) =>
    collect(bf.customers.interactions.listAll(a.external_id, params(a, "external_id"))),
  "customers.interactions.create": (bf, a) =>
    bf.customers.interactions.create(a.external_id, a.content, params(a, "external_id", "content")),
  "customers.batch": (bf, a) => bf.customers.batch(a.items.map((x: Args) => params(x))),
  "customers.identifiers.add": (bf, a) =>
    bf.customers.identifiers.add(a.external_id, a.extra_id, params(a, "external_id", "extra_id")),
  "customers.identifiers.remove": (bf, a) => bf.customers.identifiers.remove(a.external_id, a.extra_id),
  "people.upsert": (bf, a) =>
    bf.people.upsert(
      a.customer_external_id,
      a.person_external_id,
      params(a, "customer_external_id", "person_external_id"),
    ),
  "people.list": (bf, a) => bf.people.list(a.customer_external_id),
  "people.delete": (bf, a) => bf.people.delete(a.customer_external_id, a.person_external_id),
  "people.batch": (bf, a) => bf.people.batch(a.items.map((x: Args) => params(x))),
  "people.identifiers.list": (bf, a) => bf.people.identifiers.list(a.person_external_id),
  "people.identifiers.add": (bf, a) =>
    bf.people.identifiers.add(a.person_external_id, a.extra_id, params(a, "person_external_id", "extra_id")),
  "people.identifiers.remove": (bf, a) => bf.people.identifiers.remove(a.person_external_id, a.extra_id),
  "products.list": (bf, a) => bf.products.list(params(a)),
  "products.get": (bf, a) => bf.products.get(a.slug),
  "products.upsert": (bf, a) => bf.products.upsert(a.slug, params(a, "slug")),
  "products.archive": (bf, a) => bf.products.archive(a.slug),
  "release_notes.list": async (bf, a) =>
    pageJson(await bf.releaseNotes.list(a.product_slug, params(a, "product_slug"))),
  "release_notes.list_all": (bf, a) => collect(bf.releaseNotes.listAll(a.product_slug, params(a, "product_slug"))),
  "release_notes.get": (bf, a) => bf.releaseNotes.get(a.product_slug, a.version),
  "release_notes.upsert": (bf, a) =>
    bf.releaseNotes.upsert(a.product_slug, a.version, params(a, "product_slug", "version")),
  "release_notes.publish": (bf, a) => bf.releaseNotes.publish(a.product_slug, a.version),
  "kb.articles.list": async (bf, a) => pageJson(await bf.kb.articles.list(params(a))),
  "kb.articles.list_all": (bf, a) => collect(bf.kb.articles.listAll(params(a))),
  "kb.articles.get": (bf, a) => bf.kb.articles.get(a.external_id),
  "kb.articles.upsert": (bf, a) => bf.kb.articles.upsert(a.external_id, params(a, "external_id")),
  "kb.articles.batch_upsert": (bf, a) => bf.kb.articles.batchUpsert(a.articles.map((x: Args) => params(x))),
  "kb.articles.publish": (bf, a) => bf.kb.articles.publish(a.external_id),
  "kb.articles.unpublish": (bf, a) => bf.kb.articles.unpublish(a.external_id),
  "kb.articles.delete": (bf, a) => bf.kb.articles.delete(a.external_id),
  "kb.search": (bf, a) => bf.kb.search(a.q, params(a, "q")),
  "ai_agents.list": (bf) => bf.aiAgents.list(),
  "ai_agents.get": (bf, a) => bf.aiAgents.get(a.agent_id),
  "ai_agents.preview": (bf, a) => bf.aiAgents.preview(a.agent_id, a.message, params(a, "agent_id", "message")),
};

// ── Conferência de cada troca ────────────────────────────────────────────────

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CLIENT_RE = new RegExp(`^bfocus-node/${VERSION.replace(/\./g, "\\.")}$`);

function header(req: Recorded, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v.join(", ") : v;
}

/** Confere a requisição `index` da chamada; devolve a lista de divergências. */
function check(c: Case, index: number, req: Recorded, seen: Recorded[]): string[] {
  const exp = c.exchanges[index]!.request;
  const at = `[troca ${index + 1}]`;
  const problems: string[] = [];
  const eq = (label: string, got: unknown, want: unknown) => {
    try {
      assert.deepStrictEqual(got, want);
    } catch {
      problems.push(`${at} ${label}: recebido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`);
    }
  };

  eq("método", req.method, exp.method);
  eq("caminho", req.path, exp.path);
  const keys = req.queryPairs.map(([k]) => k);
  if (new Set(keys).size !== keys.length) problems.push(`${at} query com chave repetida: ${keys.join(",")}`);
  eq("query", Object.fromEntries(req.queryPairs), exp.query);
  eq("corpo", req.body, exp.body);

  eq("Authorization", header(req, "authorization"), `Bearer ${CASES.api_key}`);
  eq("Accept", header(req, "accept"), "application/json");
  const client = header(req, "x-bfocus-client") ?? "";
  if (!CLIENT_RE.test(client)) problems.push(`${at} X-Bfocus-Client inválido: ${client}`);
  eq("User-Agent", header(req, "user-agent"), client);
  eq("Content-Type", header(req, "content-type"), exp.body === null ? undefined : "application/json");

  const rid = header(req, "x-request-id");
  if (!rid || !/^[0-9a-f]{32}$/.test(rid)) problems.push(`${at} X-Request-Id ausente/fora do formato: ${rid}`);
  const idem = header(req, "idempotency-key");
  if (WRITE.has(exp.method) && !idem) problems.push(`${at} Idempotency-Key ausente numa escrita`);
  if (!WRITE.has(exp.method) && idem !== undefined) problems.push(`${at} Idempotency-Key numa leitura`);

  if (index === 0 && c.exchanges[0]!.retry) problems.push(`${at} a primeira troca não pode ser retry`);
  if (index > 0) {
    const prev = seen[index - 1]!;
    if (c.exchanges[index]!.retry) {
      eq("X-Request-Id repetido na nova tentativa", rid, header(prev, "x-request-id"));
      eq("Idempotency-Key repetida na nova tentativa", idem, header(prev, "idempotency-key"));
    } else if (rid === header(prev, "x-request-id")) {
      problems.push(`${at} X-Request-Id reaproveitado entre chamadas lógicas diferentes`);
    }
  }
  return problems;
}

const ERROR_TYPES = new Map<Function, string>([
  [AuthenticationError, "authentication"],
  [PermissionDeniedError, "permission_denied"],
  [NotFoundError, "not_found"],
  [ConflictError, "conflict"],
  [ValidationError, "validation"],
  [RateLimitError, "rate_limit"],
  [ServerError, "server"],
  [NetworkError, "network"],
  [BfocusError, "api"],
]);

/** `sentRequestId` = X-Request-Id que a SDK enviou (o valor especial `"$sent"` do caso). */
function compareError(err: unknown, exp: Record<string, any>, sentRequestId: string | undefined): void {
  assert.ok(err instanceof BfocusError, `esperava BfocusError, veio ${String(err)}`);
  assert.equal(ERROR_TYPES.get(err.constructor), exp.type, "tipo do erro");
  assert.equal(err.code, exp.code, "code");
  assert.equal(err.status, exp.status, "status");
  assert.ok(err.message.includes(exp.code), "message traz o code");
  if ("request_id" in exp) {
    const want = exp.request_id === "$sent" ? sentRequestId : exp.request_id;
    assert.ok(want, "request_id esperado indefinido");
    assert.equal(err.requestId, want, "requestId");
  }
  if ("retry_after" in exp) assert.equal(err.retryAfter, exp.retry_after, "retryAfter");
  if ("required_scope" in exp) assert.equal(err.requiredScope, exp.required_scope, "requiredScope");
  if ("validation" in exp) assert.deepStrictEqual(err.validation, exp.validation, "validation");
}

// ── Suíte ────────────────────────────────────────────────────────────────────

describe("conformidade: tabela de operações", () => {
  it("todo op dos casos tem método na SDK (ou está em sdk_excluded_ops)", () => {
    const missing = [...new Set(CASES.cases.map((c) => c.op))].filter(
      (op) => !(op in OPS) && !CASES.sdk_excluded_ops.includes(op),
    );
    assert.deepEqual(missing, [], `ops sem método na SDK: ${missing.join(", ")}`);
  });

  it("nenhuma op excluída foi implementada e toda op da tabela tem caso", () => {
    for (const op of CASES.sdk_excluded_ops) assert.ok(!(op in OPS), `${op} está em sdk_excluded_ops`);
    const covered = new Set(CASES.cases.map((c) => c.op));
    const untested = Object.keys(OPS).filter((op) => !covered.has(op));
    assert.deepEqual(untested, [], `ops da tabela sem caso: ${untested.join(", ")}`);
  });

  it("helpers apontam para ops existentes", () => {
    for (const [helper, base] of Object.entries(CASES.sdk_helper_ops ?? {})) {
      assert.ok(helper in OPS, `helper ${helper} sem método`);
      assert.ok(base in OPS, `base ${base} do helper ${helper} sem método`);
    }
  });

  it("toda operação de public.json está na tabela (quando a spec está disponível)", (t) => {
    if (!existsSync(PUBLIC_SPEC)) {
      t.skip("api/openapi/public.json fora do alcance (espelho público)");
      return;
    }
    const spec = JSON.parse(readFileSync(PUBLIC_SPEC, "utf8")) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const ops = Object.values(spec.paths).flatMap((methods) =>
      Object.values(methods)
        .map((o) => o.operationId)
        .filter((id): id is string => typeof id === "string"),
    );
    const missing = ops.filter((op) => !(op in OPS) && !CASES.sdk_excluded_ops.includes(op));
    assert.deepEqual(missing, [], `operações públicas sem método na SDK: ${missing.join(", ")}`);
  });
});

describe("conformidade: casos", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  after(() => server.close());

  for (const c of CASES.cases) {
    it(c.id, async () => {
      const run = OPS[c.op];
      assert.ok(run, `op sem método: ${c.op}`);
      server.reset();
      const problems: string[] = [];
      server.setHandler((req) => {
        const index = server.requests.length - 1;
        const exchange = c.exchanges[index];
        if (!exchange) {
          problems.push(`requisição inesperada #${index + 1}: ${req.method} ${req.path}`);
          return { status: 599, body: { error: "UNEXPECTED_REQUEST" } };
        }
        problems.push(...check(c, index, req, server.requests));
        return exchange.response;
      });

      const sleeps: number[] = [];
      const bf = new Bfocus({
        apiKey: CASES.api_key,
        baseUrl: server.url,
        sleep: async (ms) => {
          sleeps.push(ms); // espera desligada: registra, não dorme
        },
      });

      let result: unknown;
      let error: unknown;
      try {
        result = await run(bf, c.args);
      } catch (e) {
        error = e;
      }

      assert.deepEqual(problems, []);
      assert.equal(server.requests.length, c.exchanges.length, "número de requisições");
      const retries = c.exchanges.filter((x) => x.retry).length;
      assert.equal(sleeps.length, retries, "esperas entre tentativas");

      if (c.expect.error) {
        const last = server.requests[server.requests.length - 1];
        compareError(error, c.expect.error, last ? header(last, "x-request-id") : undefined);
      } else {
        if (error) throw error;
        assert.deepStrictEqual(result, c.expect.result);
      }
    });
  }
});

describe("conformidade: assinaturas do widget", () => {
  for (const [i, v] of CASES.signatures.entries()) {
    it(`vetor ${i + 1}`, () => {
      assert.equal(signWidgetIdentity(v.secret, v.user_external_id, v.customer_external_id), v.expected);
    });
  }
});

describe("conformidade: assinaturas v2 do widget", () => {
  for (const [i, v] of CASES.signatures_v2.entries()) {
    it(`vetor ${i + 1}`, () => {
      assert.equal(
        signWidgetIdentityV2(v.secret, v.user_external_id, v.customer_external_id, { now: v.timestamp }),
        v.expected,
      );
      assert.equal(
        signWidgetIdentityV2(v.secret, v.user_external_id, v.customer_external_id, {
          now: new Date(v.timestamp * 1000 + 999),
        }),
        v.expected,
        "Date é truncado para segundos inteiros",
      );
    });
  }
});
