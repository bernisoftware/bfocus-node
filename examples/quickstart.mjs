/**
 * Quickstart do @bfocus/sdk.
 *
 *   BFOCUS_API_KEY=bf_live_... node examples/quickstart.mjs
 *
 * Variáveis:
 *   BFOCUS_API_KEY   obrigatória (Integrações → Chaves de API)
 *   BFOCUS_BASE_URL  opcional (padrão: produção; dev: http://localhost:8000)
 *
 * Dentro deste repositório, rode `npm run build` antes (o import abaixo resolve para dist/).
 * Num projeto seu, basta `npm install @bfocus/sdk`.
 */
import { Bfocus, BfocusError } from "@bfocus/sdk";

const apiKey = process.env.BFOCUS_API_KEY;
if (!apiKey) {
  console.error("Defina BFOCUS_API_KEY (crie a chave em Integrações → Chaves de API).");
  process.exit(1);
}

const bf = new Bfocus({ apiKey, baseUrl: process.env.BFOCUS_BASE_URL });

/** Roda um passo e explica o erro (pelo `code`) sem derrubar os seguintes. */
async function step(title, fn) {
  try {
    const out = await fn();
    console.log(`✓ ${title}`, out ?? "");
  } catch (err) {
    if (!(err instanceof BfocusError)) throw err;
    const hint = err.requiredScope ? ` — a chave precisa do escopo ${err.requiredScope}` : "";
    console.log(`✗ ${title}: ${err.code} (HTTP ${err.status}, request_id ${err.requestId})${hint}`);
  }
}

// Hello world: cria/atualiza um cliente pelo id do SEU sistema (customers:write).
await step("customers.upsert", async () => {
  const customer = await bf.customers.upsert("EXEMPLO-001", {
    name: "Padaria Exemplo",
    email: "contato@padaria.example",
    customFields: [{ key: "plano", label: "Plano", value: "ouro" }],
  });
  return `${customer.name} (${customer.id})`;
});

// Primeira página de clientes (customers:read).
await step("customers.list", async () => {
  const page = await bf.customers.list({ pageSize: 5 });
  return `${page.total} cliente(s); nesta página: ${page.items.map((c) => c.name).join(", ") || "—"}`;
});

// Catálogo de produtos (products:read).
const products = [];
await step("products.list", async () => {
  products.push(...(await bf.products.list()));
  return products.map((p) => `${p.slug}@${p.current_version}`).join(", ") || "nenhum produto";
});

// Busca na base de conhecimento (kb:read).
await step("kb.search", async () => {
  const hits = await bf.kb.search("como emitir nota fiscal", { limit: 3 });
  return hits.map((h) => h.title).join(" | ") || "nenhum artigo encontrado";
});

// Últimas release notes publicadas do primeiro produto (release_notes:read).
if (products[0]) {
  await step(`releaseNotes.list(${products[0].slug})`, async () => {
    const page = await bf.releaseNotes.list(products[0].slug, { published: true, pageSize: 3 });
    return page.items.map((n) => `${n.version} ${n.title}`).join(" | ") || "nenhuma publicada";
  });
}
