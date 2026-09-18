# @bfocus/sdk

SDK oficial do **bFocus** para Node.js e TypeScript: clientes, contatos, produtos, release notes,
base de conhecimento e agentes de IA.

- ESM **e** CommonJS, com tipos (`.d.ts`) para todas as entidades
- **Zero dependências de runtime** — usa o `fetch` nativo do Node 18+
- Novas tentativas seguras (idempotência automática) e erros com `code` estável

```bash
npm install @bfocus/sdk
```

```ts
import { Bfocus } from "@bfocus/sdk";

const bf = new Bfocus({ apiKey: process.env.BFOCUS_API_KEY! });

const customer = await bf.customers.upsert("ERP 1042", {
  name: "Padaria Estrela",
  email: "contato@padaria.example",
});
console.log(customer.id);
```

CommonJS também funciona: `const { Bfocus } = require("@bfocus/sdk");`

> **Fixe a versão exata** no `package.json` (`"@bfocus/sdk": "0.1.0"`, sem `^`). Cada release
> declara se muda a superfície pública; suba de versão em versão lendo essa linha.

---

## Autenticação

Crie a chave no painel do bFocus em **Integrações → Chaves de API**, marcando só os escopos de
que a integração precisa. Toda requisição vai com `Authorization: Bearer <chave>`.

| Escopo | Libera |
|---|---|
| `customers:read` / `customers:write` | clientes, contatos, produtos vinculados e interações |
| `products:read` / `products:write` | catálogo de produtos |
| `release_notes:read` / `release_notes:write` | release notes |
| `kb:read` / `kb:write` | base de conhecimento |
| `ai_agents:read` / `ai_agents:preview` | agentes de IA (o preview consome IA da conta) |

A chave legada (`bf_sk_…`) só alcança clientes. Chamada sem o escopo → `PermissionDeniedError`
com `code = "INTEGRATION_SCOPE_MISSING"` e o escopo que faltou em `err.requiredScope`.

## Configuração

```ts
const bf = new Bfocus({
  apiKey: "bf_live_...",              // obrigatória
  baseUrl: "http://localhost:8000",   // opcional; padrão https://api.bfocus.com.br
  timeout: 30_000,                    // ms por tentativa (padrão 30000)
  maxRetries: 2,                      // novas tentativas além da primeira (0 desliga)
  fetch: myFetch,                     // opcional: outro fetch (proxy, instrumentação…)
});

// Equivalente, com a chave como primeiro argumento:
const bf2 = new Bfocus("bf_live_...", { timeout: 10_000 });
```

Construir o cliente não faz chamada de rede. Toda chamada aceita, como último argumento,
`{ idempotencyKey?, timeout?, maxRetries?, signal? }`.

### Convenções

- **Parâmetros em camelCase** (`customFields`, `pageSize`, `updatedSince`); a SDK converte para o
  snake_case da API.
- **Os upserts são parciais**: só o que você passa muda. `undefined`/ausente = não mexe;
  `null` = limpa o campo.
- **Respostas exatamente como a API documenta** (snake_case: `external_id`, `is_active`…). Campos
  que a API passar a devolver no futuro chegam intactos.
- Listas paginadas devolvem `Page<T>`: `{ items, page, pageSize, total, pages }`. Os métodos
  `listAll()` percorrem todas as páginas sob demanda (`for await`).
- Datas de filtro (`updatedSince`) aceitam `Date` (enviada em UTC com `Z`) ou string ISO 8601.
- Ids no caminho (`externalId`, `slug`…) são codificados por segmento (`ERP 1042` → `ERP%201042`).
  Vazio, `"."` ou `".."` lançam `TypeError` antes de qualquer requisição (o parser de URL resolveria
  `%2E%2E` como "pasta acima" e a chamada iria para outra rota); em artigos, `/` também é recusado
  (use `:` para hierarquia).
- Listagens de artigos (`list`/`listAll`) devolvem `KbArticleSummary` (sem `body_html`); `get`,
  `upsert`, `publish` e `unpublish` devolvem `KbArticle`, com `body_html`.

---

## Clientes

```ts
// Cria/atualiza pelo id do SEU sistema. customFields, quando enviada, SUBSTITUI a lista.
await bf.customers.upsert("ERP 1042", {
  name: "Padaria Estrela",
  document: "12.345.678/0001-90",
  customFields: [{ key: "plano", label: "Plano", type: "select", value: "ouro", options: ["prata", "ouro"] }],
});
await bf.customers.upsert("ERP 1042", { phone: null }); // limpa só o telefone

const c = await bf.customers.get("ERP 1042");
const page = await bf.customers.list({ q: "padaria", pageSize: 50 });

// Sincronização incremental: tudo que mudou desde a última execução, em todas as páginas.
for await (const customer of bf.customers.listAll({ updatedSince: lastSync })) {
  await saveLocally(customer);
}

await bf.customers.delete("ERP 1042");

// Contatos
await bf.customers.contacts.upsert("ERP 1042", "CT-1", { name: "Ana Souza", role: "Financeiro", isPrimary: true });
const contacts = await bf.customers.contacts.list("ERP 1042");
await bf.customers.contacts.delete("ERP 1042", "CT-1");

// Produtos que o cliente usa
await bf.customers.products.attach("ERP 1042", "erp-cloud");
const used = await bf.customers.products.list("ERP 1042");
await bf.customers.products.detach("ERP 1042", "erp-cloud");

// Linha do tempo (HTML ou texto puro)
await bf.customers.interactions.create("ERP 1042", "Pedido 1042 faturado.", {
  isInternal: true,
  authorEmail: "carla@suaempresa.com.br", // usuário do bFocus que assina; omitido = "sistema"
});
const history = await bf.customers.interactions.list("ERP 1042", { pageSize: 20 });
```

## Produtos

```ts
await bf.products.upsert("erp-cloud", { name: "ERP Cloud", description: "Gestão na nuvem", color: "#6366F1" });
const products = await bf.products.list();                       // ativos
const all = await bf.products.list({ includeInactive: true });   // + arquivados
const p = await bf.products.get("erp-cloud");                    // p.current_version, p.ai_level…
await bf.products.archive("erp-cloud");
```

## Release notes — publicar no CI

No pipeline de release, depois do deploy, publique a nota da versão (Markdown vira HTML
sanitizado). A chamada é idempotente: rodar de novo a mesma versão só atualiza.

```ts
// scripts/publish-release-note.mjs — rode no CI com BFOCUS_API_KEY (release_notes:write)
import { readFile } from "node:fs/promises";
import { Bfocus } from "@bfocus/sdk";

const bf = new Bfocus({ apiKey: process.env.BFOCUS_API_KEY });
const version = process.env.GITHUB_REF_NAME; // ex.: "v2.3.0" (o "v" é aceito)

await bf.releaseNotes.upsert("erp-cloud", version, {
  title: "Emissão de NFS-e em lote",
  descriptionMarkdown: await readFile("RELEASE_NOTES.md", "utf8"),
  audience: "external", // "internal" (equipe), "external" (clientes no widget) ou "both"
  publish: true,
});
```

```ts
const notes = await bf.releaseNotes.list("erp-cloud", { published: true });
const note = await bf.releaseNotes.get("erp-cloud", "2.3.0");
await bf.releaseNotes.publish("erp-cloud", "2.4.0"); // publica um rascunho
```

## Base de conhecimento — sincronizar de arquivos Markdown

Mantenha a documentação no seu repositório e espelhe no bFocus. `batchUpsert` aceita **qualquer
quantidade** de artigos: a SDK divide em lotes de 100, envia em sequência e devolve um resultado
único. Artigos iguais aos já salvos voltam como `unchanged` (nada é regravado).

```ts
// scripts/sync-kb.mjs — kb:write
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Bfocus } from "@bfocus/sdk";

const bf = new Bfocus({ apiKey: process.env.BFOCUS_API_KEY });
const ROOT = "docs";

const files = (await readdir(ROOT, { recursive: true })).filter((f) => f.endsWith(".md"));
const articles = await Promise.all(
  files.map(async (file) => {
    const markdown = await readFile(join(ROOT, file), "utf8");
    return {
      // external_id estável e SEM "/" — use ":" para hierarquia: docs/fiscal/nfse.md → git:fiscal:nfse
      externalId: `git:${file.replace(/\.md$/, "").split(/[\\/]/).join(":")}`,
      title: markdown.match(/^#\s+(.+)$/m)?.[1] ?? file,
      bodyMarkdown: markdown,
      product: "erp-cloud", // ou null para valer em todos os produtos
      status: "published",  // só publicados alimentam o agente de IA
    };
  }),
);

const result = await bf.kb.articles.batchUpsert(articles);
console.log(`criados ${result.created}, atualizados ${result.updated}, iguais ${result.unchanged}, falhas ${result.failed}`);
for (const r of result.results.filter((r) => !r.ok)) console.error(`${r.external_id}: ${r.error}`);
```

Um artigo por vez, publicação e busca:

```ts
await bf.kb.articles.upsert("notion:emitir-nfse", { title: "Como emitir NFS-e", bodyMarkdown: "# Passo a passo…" });
await bf.kb.articles.publish("notion:emitir-nfse");   // passa a alimentar o agente de IA
await bf.kb.articles.unpublish("notion:emitir-nfse"); // volta para rascunho
const article = await bf.kb.articles.get("notion:emitir-nfse"); // com body_html
for await (const a of bf.kb.articles.listAll({ product: "erp-cloud", status: "published" })) console.log(a.title);
await bf.kb.articles.delete("notion:emitir-nfse");

const hits = await bf.kb.search("como emitir nota fiscal", { product: "erp-cloud", limit: 5 });
```

## Agentes de IA

```ts
const agents = await bf.aiAgents.list();
const agent = await bf.aiAgents.get(agents[0].id);

// Simula a resposta do agente (nada é enviado a cliente algum; consome IA da conta).
const preview = await bf.aiAgents.preview(agent.id, "Como emito uma NFS-e?", {
  history: [
    { role: "customer", content: "Oi" },
    { role: "bot", content: "Olá! Como posso ajudar?" },
  ],
});
console.log(preview.action, preview.answer_html, preview.sources);
```

---

## Erros

Qualquer resposta fora de 2xx lança `BfocusError` (ou uma subclasse). **Use `err.code` na sua
lógica** — é estável. `err.message` é texto para humanos e pode mudar.

```ts
import { BfocusError, NotFoundError, ValidationError } from "@bfocus/sdk";

try {
  await bf.customers.get("nao-existe");
} catch (err) {
  if (err instanceof BfocusError && err.code === "CUSTOMER_NOT_FOUND") {
    // trate o caso
  } else if (err instanceof ValidationError) {
    console.error(err.validation); // { email: "value is not a valid email address" }
  } else {
    throw err;
  }
}
```

| Campo | Conteúdo |
|---|---|
| `code` | código estável (`CUSTOMER_NOT_FOUND`, `VALIDATION_ERROR`…; `HTTP_<status>` se o corpo não for JSON) |
| `status` | status HTTP (`0` em erro de rede) |
| `requestId` | id da requisição — informe ao suporte (do corpo, senão do header, senão o `X-Request-Id` que a SDK enviou; a API ecoa o mesmo id, então ele bate com o log — vale também para `NetworkError`) |
| `validation` | campo → motivo (422) |
| `retryAfter` | segundos pedidos pelo `Retry-After` (429) |
| `requiredScope` | escopo que faltou na chave (403) |

| Classe | Quando |
|---|---|
| `AuthenticationError` | 401 — chave ausente, inválida ou revogada |
| `PermissionDeniedError` | 403 — sem escopo, chave desligada ou IP não liberado |
| `NotFoundError` | 404 |
| `ConflictError` | 409 — ex.: `KB_ARTICLE_EMPTY`, `AI_DISABLED`, `RELEASE_NOTE_CONFLICT` |
| `ValidationError` | 422 |
| `RateLimitError` | 429 (depois de esgotar as novas tentativas) |
| `ServerError` | 5xx |
| `NetworkError` | conexão recusada, DNS, tempo esgotado (`status = 0`, `code = "NETWORK_ERROR"`) |
| `BfocusError` (base) | outros status; e resposta 2xx sem o envelope JSON da API (`code = "INVALID_RESPONSE"`, com o status recebido) |

Cancelar pela `signal` rejeita com o `AbortError` original (não é `BfocusError`).

### Novas tentativas e idempotência

A SDK tenta de novo sozinha (até `maxRetries`, padrão 2) em erro de rede/timeout, `429`, `502`,
`503` e `504` — nada mais. Espera o `Retry-After` quando a API manda (teto de 60 s); senão,
0,5 s, 1 s, 2 s… (teto de 8 s) com até 25% de variação.

Toda escrita (`POST`/`PUT`/`DELETE`) sai com um `Idempotency-Key` gerado por chamada e **repetido**
nas novas tentativas, junto com o mesmo `X-Request-Id`: se a primeira tentativa chegou a executar,
a API devolve a resposta original (`Idempotent-Replayed: true`) em vez de executar de novo. Para
proteger uma operação entre execuções (um job que pode rodar duas vezes), passe a sua chave:

```ts
await bf.customers.interactions.create("ERP 1042", "Pedido 1042 faturado.", {}, {
  idempotencyKey: `pedido-1042-faturado`,
});
```

No `batchUpsert` com mais de um lote, o 1º lote usa a sua chave como veio e os seguintes
`<sua-chave>:2`, `<sua-chave>:3`… (sem chave sua, cada lote gera a própria).

## Identidade do widget

Para o widget do bFocus reconhecer o usuário logado no seu sistema, assine a identidade **no seu
backend** e entregue a assinatura à página que abre o widget. O segredo do widget nunca vai ao
navegador. É uma função local (sem rede, sem `apiKey`):

```ts
import { signWidgetIdentity } from "@bfocus/sdk";

// HMAC-SHA256(secret, "v1:" + userExternalId + ":" + customerExternalId), hex minúsculo
const signature = signWidgetIdentity(process.env.BFOCUS_WIDGET_SECRET!, user.id, user.companyId);
```

## Requisitos

Node.js 18 ou superior (também roda em Bun e Deno, que oferecem `fetch` e `node:crypto`). A SDK é
para **backend**: a chave de API dá acesso à sua conta e não deve ir ao navegador.

## Desenvolvimento

```bash
npm install
npm run build   # dist/esm + dist/cjs + .d.ts
npm test        # conformidade (servidor local) + unitários, contra o pacote construído
BFOCUS_API_KEY=... node examples/quickstart.mjs
```

A suíte roda os casos de conformidade compartilhados por todas as SDKs do bFocus, a partir da cópia
em `test/conformance/cases.json`. Essa cópia é escrita por `python3 clients/conformance/generate.py`
no monorepo (não edite à mão); lá, a suíte falha se ela divergir da original.

## Licença

MIT © Berni Software
