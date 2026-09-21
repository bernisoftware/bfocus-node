# @bfocus/sdk

SDK oficial do **bFocus** para Node.js e TypeScript: clientes, contatos, pessoas, lotes,
identificadores extras, produtos, release notes, base de conhecimento e agentes de IA.

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
| `customers:read` / `customers:write` | clientes, contatos, pessoas, lotes, identificadores extras, produtos vinculados e interações |
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

## Pessoas

Pessoas são quem, do lado do cliente, abre chamados pelo widget/portal. O id da pessoa é o do SEU
sistema — o mesmo `user.externalId` que você assina no widget (por isso **sem `:`**).

```ts
// Cria/atualiza. Só o que você passa muda; null limpa.
const p = await bf.people.upsert("erp-1042", "app-77", {
  name: "Paula Reis",
  email: "paula@padaria.example",
  role: "Financeiro",
  isPrimary: true,
  extraEmails: ["paula.reis@pessoal.example"],
});
p.status; // "created" | "updated" | "unchanged"

const people = await bf.people.list("erp-1042");     // com e sem acesso
await bf.people.delete("erp-1042", "app-77");         // retira o acesso (devolve a pessoa com access: false)
await bf.people.upsert("erp-1042", "app-77", { access: true }); // devolve o acesso
```

- **Nunca duplica**: se o e-mail (ou o telefone) já é de uma pessoa que chegou antes — por e-mail,
  pelo widget ou por outro sistema — o upsert **adota** essa pessoa e passa a reconhecê-la pelo seu id.
- A mesma pessoa informada com **outro cliente** NÃO é transferida: fica **ligada** também a ele
  (`linked: true` na resposta). O cadastro é único e a mesma pessoa circula por vários clientes.
- **O acesso é do vínculo.** `delete` (e `access: false`) tira o acesso dela NESTE cliente, não nos
  outros: `unlinked: true` na resposta quer dizer que ela segue ativa em algum outro.
- `delete` não apaga: retira o acesso e a pessoa continua no histórico dos chamados.
- Erros comuns (`err.code`): `CUSTOMER_NOT_FOUND`, `NAME_REQUIRED` (ao criar), `PERSON_EMAIL_TAKEN`,
  `PERSON_PHONE_TAKEN`, `PERSON_CONTACT_OTHER_CUSTOMER`, `PERSON_EMAIL_STAFF` (e-mail de alguém da
  sua equipe no bFocus), `PERSON_CLEAR_FIELD_INVALID` e `PERSON_CLEAR_NOT_OWN_RECORD` (ver
  [Apagar o e-mail ou o telefone](#apagar-o-e-mail-ou-o-telefone-da-pessoa)),
  `PERSON_DOCUMENT_INVALID` e `PERSON_DOCUMENT_CONFLICT` (ver [CPF](#cpf-a-pessoa-é-única)).

### Campos personalizados da pessoa

`customFields` leva o que só existe no seu sistema (matrícula, centro de custo, filial). É a
**exceção** ao "só o que vier muda": a lista enviada **substitui a lista inteira** — campo que
ficar de fora é **removido**. Mande sempre a lista que o seu sistema tem hoje; omitir a propriedade não mexe
em nada, como em qualquer outro campo.

A `visibility` é decidida no bFocus e **preservada entre sincronizações** — por isso ela não vai
no envio, só volta na resposta: o seu ERP não rebaixa nem promove a exposição de um dado sem
querer.

Vale no upsert de pessoa, no lote de pessoas e na listagem de pessoas do cliente.

```ts
const p = await bf.people.upsert("erp-1042", "app-77", {
  customFields: [                        // a lista INTEIRA do seu sistema
    { key: "matricula", label: "Matrícula", value: "4471" },
    { key: "filial", label: "Filial", value: "Centro" },
  ],
});
for (const campo of p.custom_fields) {
  console.log(campo.key, campo.value, campo.visibility); // visibility vem do bFocus
}
```

### Apagar o e-mail ou o telefone da pessoa

Um contato gravado errado ficava preso para sempre: enquanto a ficha errada segurasse o
telefone, nenhum reenvio o soltava. `clear` apaga.

```ts
await bf.people.upsert("erp-1042", "app-77", { clear: ["phone"] });            // some o telefone
await bf.people.upsert("erp-1042", "app-77", { clear: ["email", "phone"] });   // some os dois
```

Três regras que parecem contraintuitivas e são de propósito:

- **Apagar é explícito.** `phone: null`, `clear: []` e omitir a propriedade continuam
  significando **"não mexe"** — a SDK não traduz `null` em `clear`. Fazer o `null` apagar
  teria apagado, em silêncio e na primeira carga seguinte, o dado de todo sistema que manda
  `null` para "não tenho esse valor".
- **Campo fora da lista é recusado, não ignorado**: hoje só `"email"` e `"phone"`; qualquer
  outro devolve 422 `PERSON_CLEAR_FIELD_INVALID` (`ValidationError`).
- **Só se limpa a própria ficha.** Se você alcançou a pessoa por um identificador **extra**, a
  API recusa com 409 `PERSON_CLEAR_NOT_OWN_RECORD` (`ConflictError`): apagar o contato de uma
  ficha alcançada por apelido seria apagar dado de outro sistema. Para saber se o id que você
  tem em mãos é o principal ou um extra, use `bf.people.identifiers.list(...)`.

Vale no `people.upsert` e no `people.batch` (`clear: ["phone"]` no item).

### CPF: a pessoa é única

`document` é o CPF da pessoa. É por ele que dois sistemas que conhecem a mesma pessoa por ids
diferentes chegam ao MESMO cadastro.

```ts
const p = await bf.people.upsert("erp-1042", "app-91", { name: "Paula Reis", document: "529.982.247-25" });
p.document;     // "52998224725"
p.merged_into;  // "app-77" se o CPF já era de outra ficha; null se não
```

Regras (valem no upsert e no lote):

- **A pessoa é única.** O mesmo CPF é sempre o mesmo cadastro, em qualquer produto e cliente. Mande
  com ou sem máscara; a resposta traz só os 11 dígitos em `document`.
- **Id desconhecido + CPF que já existe** → a API acha a ficha, o seu id vira identificador extra
  dela e a resposta vem com `merged_into` = o id principal. Guarde esse id do seu lado.
- **Id de uma ficha + CPF de OUTRA** → as duas são mescladas na hora; `merged_into` = a que tinha o CPF.
- **`document: null` NÃO apaga** o CPF (e `document` não é campo do `clear`). Omitir é o mesmo que "não mexe".
- Erros: 422 `PERSON_DOCUMENT_INVALID` (CPF inválido, `ValidationError`) e 409 `PERSON_DOCUMENT_CONFLICT` (a
  ficha já tem OUTRO CPF — a API nunca troca sozinho; `ConflictError`).

No lote: `document: "529.982.247-25"` no item.

### Contato já usado: um 409 que você consegue resolver

`PERSON_EMAIL_TAKEN` e `PERSON_PHONE_TAKEN` (409) não são "tente de novo": o e-mail (ou o
telefone) já é de outra pessoa da conta. O erro diz **de quem**, em `err.data` (a API repete o mesmo
detalhe em `err.validation`, por compatibilidade):

| campo | o que é |
| --- | --- |
| `field` | `email` ou `phone` — qual contato está tomado |
| `owner_external_id` | o identificador da pessoa que já usa esse contato |
| `owner_name` | o nome dela |
| `owner_customer_external_id` | o cliente a que ela pertence |

**É o `owner_customer_external_id` que decide a ação**, e os dois casos pedem coisas opostas:

- **mesmo cliente que você enviou** → é quase sempre a MESMA pessoa em dois sistemas. Uma pessoa
  tem **N identificadores**: registre o seu como **extra** dela. A partir daí o seu id encontra
  essa pessoa.
- **outro cliente** → ninguém decide sozinho a quem a pessoa pertence. Não force: registre o caso
  e leve para quem conhece o cadastro. Unificar dois clientes é decisão de gente, não de um
  casamento por e-mail.

```ts
import { ConflictError } from "@bfocus/sdk";

try {
  await bf.people.upsert("erp-1042", "app-77", { name: "Paula Reis", email: "paula@padaria.example" });
} catch (err) {
  if (!(err instanceof ConflictError) || !["PERSON_EMAIL_TAKEN", "PERSON_PHONE_TAKEN"].includes(err.code)) throw err;
  const dono = err.data as Record<string, string>;
  if (dono["owner_customer_external_id"] === "erp-1042") {
    // A mesma pessoa, com dois ids: o seu vira mais um identificador dela.
    await bf.people.identifiers.add(dono["owner_external_id"]!, "app-77", { label: "ERP" });
  } else {
    // Dono em OUTRO cliente: não decida sozinho — registre e leve para o cadastro.
    await avisarCadastro(err.code, dono);
  }
}
```

`PERSON_CONTACT_OTHER_CUSTOMER` (409) é o mesmo assunto pelo outro lado: o e-mail (ou o telefone) é
de uma pessoa de **outro cliente**. A API **não liga duas fichas sozinha** só porque o contato casou
— dois cadastros podem dividir um e-mail ou um telefone, e ligar por palpite já destruiu fichas.
Repetir a chamada não resolve. Se for **mesmo a mesma pessoa** (confirme antes), o erro traz o dono
nos dados, como os outros dois conflitos: registre o seu id como identificador extra da ficha dele
(`owner_external_id`) e o próximo envio **liga** a pessoa ao seu cliente (`linked: true`), sem
sobrescrever os dados da outra ficha.

## Lotes

`customers.batch` e `people.batch` gravam **até 500 itens por chamada** (`BATCH_MAX`). Acima disso
a SDK lança `TypeError` **antes de qualquer requisição** — ela não divide sozinha, para que o `index`
de cada resultado seja sempre a posição no lote que você enviou. Divida você:

```ts
import { BATCH_MAX } from "@bfocus/sdk"; // 500
import type { CustomerBatchItem, PersonBatchItem } from "@bfocus/sdk";

const items: CustomerBatchItem[] = erpCustomers.map((c) => ({
  externalId: `erp-${c.id}`,   // obrigatório em cada item
  name: c.name,
  document: c.cnpj,
  email: c.email ?? undefined, // undefined = não mexe; null = limpa
}));

for (let i = 0; i < items.length; i += BATCH_MAX) {
  const slice = items.slice(i, i + BATCH_MAX);
  const { results, summary } = await bf.customers.batch(slice);
  for (const r of results) {
    if (r.status === "error") console.error(slice[r.index]!.externalId, r.error, r.code);
  }
}

// Pessoas: cliente + id da pessoa + os mesmos campos do people.upsert
const people: PersonBatchItem[] = [
  { customerExternalId: "erp-1042", externalId: "app-77", name: "Paula Reis", email: "paula@padaria.example" },
];
await bf.people.batch(people);
```

Cada item do resultado traz `index` (posição no lote), `status` (`created`, `updated`, `unchanged`
ou `error`), `external_id`, `merged_into` (o id que passou a valer, quando o cadastro foi unificado a
outro — atualize do seu lado), `error` (código estável) e `code` (status HTTP que o item teria
sozinho). `summary` soma `created`, `updated`, `unchanged` e `error`. **Um item com erro não desfaz
os outros.** Lista vazia devolve o resultado zerado sem fazer requisição. Cada chamada é uma escrita
com a própria `Idempotency-Key` (ou a sua, em `{ idempotencyKey }`).

## Identificadores extras

Ligue o id de **outro sistema seu** (CRM, e-commerce…) ao mesmo cadastro, para que ele também o
encontre. Idempotente: ligar de novo não muda nada.

```ts
const c = await bf.customers.identifiers.add("erp-1042", "crm-88", { label: "CRM" });
c.identifiers; // [{ external_id: "crm-88", label: "CRM", source: "api" }]
await bf.customers.identifiers.remove("erp-1042", "crm-88");

await bf.people.identifiers.add("app-77", "crm-p5");   // sem label: a requisição vai sem corpo
await bf.people.identifiers.remove("app-77", "crm-p5");
```

Se o id já pertence a **outro** cadastro, a API responde 409 → `ConflictError` com
`code = "IDENTIFIER_IN_USE"`. Remover um id que não está ligado → `NotFoundError`
(`IDENTIFIER_NOT_FOUND`).

### Ler os identificadores da pessoa (para reconciliar)

`bf.people.list(...)` mostra só o identificador **principal** de cada pessoa. Quando dois
cadastros seus eram a mesma pessoa, um dos ids virou **extra** — e some da listagem sem ter
sumido do cadastro. É isso que faz a sua conferência fechar "633 de 636" sem explicar os 3.

`people.identifiers.list` é a fonte de verdade dessa conferência, e é **leitura**: antes dela
era preciso ESCREVER (tentar um `add`) para descobrir o que tinha acontecido. Aceita no
caminho o id principal **ou qualquer um dos extras**.

```ts
const ids = await bf.people.identifiers.list("crm-p5"); // o id extra que "sumiu" da listagem
ids.external_id;  // "app-77" — o principal do cadastro
for (const i of ids.identifiers) console.log(i.external_id, i.label, i.source);
```

## Sincronizar clientes e usuários do seu sistema

**Ids com o prefixo do sistema, sem `:`** — a assinatura do widget recusa `:`. Use `-` como
separador (`erp-1042` para clientes, `app-77` para pessoas) ou UUIDs puros: vários sistemas seus
convivem no mesmo bFocus sem colisão. O id da pessoa é o `user.externalId` que você assina no widget.

**Carga inicial (no deploy da integração):** clientes em fatias de 500 → produto de cada cliente →
pessoas em fatias de 500. Confira `summary.error` e registre os itens com erro.

```ts
import { BATCH_MAX, Bfocus } from "@bfocus/sdk";
import type { BatchResult } from "@bfocus/sdk";

async function inChunks<T>(items: T[], send: (slice: T[]) => Promise<BatchResult>) {
  for (let i = 0; i < items.length; i += BATCH_MAX) {
    const slice = items.slice(i, i + BATCH_MAX);
    const { results, summary } = await send(slice);
    if (summary.error > 0) {
      for (const r of results.filter((x) => x.status === "error")) log.warn({ item: slice[r.index], error: r.error });
    }
  }
}

await inChunks(allCustomers.map(toCustomerItem), (s) => bf.customers.batch(s));
for (const c of allCustomers) await bf.customers.products.attach(`erp-${c.id}`, "erp-cloud");
await inChunks(allUsers.map(toPersonItem), (s) => bf.people.batch(s));
```

**Depois, no dia a dia:** cada evento do seu sistema vira uma chamada.

| No seu sistema | No bFocus |
|---|---|
| criou/alterou cliente | `bf.customers.upsert(id, {...})` |
| cliente passou a usar um produto | `bf.customers.products.attach(id, slug)` |
| criou/alterou usuário | `bf.people.upsert(customerId, userId, {...})` |
| excluiu/desativou usuário | `bf.people.delete(customerId, userId)` |
| excluiu cliente | `bf.customers.delete(id)` |

Se uma resposta de lote trouxer `merged_into`, atualize o id do seu lado.

**Nunca bloqueie a requisição do seu usuário esperando o bFocus.** Enfileire (job/outbox) e deixe um
worker chamar a SDK, tentando de novo com backoff. A SDK já repete `429`/`5xx` com a mesma
`Idempotency-Key`; a fila cobre as indisponibilidades longas.

```ts
// No handler do seu app: só enfileira.
await queue.add("bfocus:person", { customerId: "erp-1042", userId: "app-77", name, email });

// No worker (a fila repete com backoff se lançar):
worker.process("bfocus:person", async (job) => {
  const { customerId, userId, ...fields } = job.data;
  await bf.people.upsert(customerId, userId, fields, { idempotencyKey: `person-${userId}-${job.id}` });
});
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
| `data` | o `data` do corpo: o detalhe estruturado que alguns erros trazem (`{}` quando não há) — ex.: de quem é o contato num 409 `PERSON_EMAIL_TAKEN` |
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

### Identidade do widget v2 (com validade)

A v2 carrega o instante da assinatura e **vence**: a API aceita de 7 dias atrás até 5 minutos à
frente. Gere a cada renderização da página — nunca guarde. Vai no mesmo lugar da v1 (`userHash` do
widget); a v1 continua aceita.

```ts
import { signWidgetIdentityV2 } from "@bfocus/sdk";

// "v2.<ts>.<hex>": ts = segundos unix; hex = HMAC-SHA256(secret, "v2:" + ts + ":" + user + ":" + customer)
const userHash = signWidgetIdentityV2(process.env.BFOCUS_WIDGET_SECRET!, "app-77", "erp-1042");

// Instante fixo (testes): Date ou segundos unix (não milissegundos).
signWidgetIdentityV2(secret, "app-77", "erp-1042", { now: 1789000000 });
```

O id do usuário **não pode ter `:`** (é o separador; a SDK lança `TypeError`). Segredo ou ids vazios
e instante negativo também lançam `TypeError`.

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
