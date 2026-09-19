import { createHmac } from "node:crypto";

/**
 * Assina a identidade do usuário logado para o widget do bFocus.
 *
 * Devolve o hex minúsculo de `HMAC-SHA256(secret, "v1:" + userExternalId + ":" + customerExternalId)`
 * (UTF-8). Rode **no seu backend** — o `secret` do widget nunca pode ir para o navegador — e
 * entregue a assinatura à página que abre o widget. Local, sem rede e sem `apiKey`.
 *
 * @example
 * ```ts
 * import { signWidgetIdentity } from "@bfocus/sdk";
 * const signature = signWidgetIdentity(process.env.BFOCUS_WIDGET_SECRET!, user.id, user.companyId);
 * ```
 */
export function signWidgetIdentity(secret: string, userExternalId: string, customerExternalId: string): string {
  for (const [name, value] of [
    ["secret", secret],
    ["userExternalId", userExternalId],
    ["customerExternalId", customerExternalId],
  ] as const) {
    if (typeof value !== "string" || value === "") {
      throw new TypeError(`bFocus: \`${name}\` é obrigatório (string não vazia).`);
    }
  }
  return createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`v1:${userExternalId}:${customerExternalId}`, "utf8")
    .digest("hex");
}

/** Opções de {@link signWidgetIdentityV2}. */
export interface SignWidgetIdentityV2Options {
  /**
   * Instante da assinatura: `Date` ou segundos unix (NÃO milissegundos). Padrão: agora.
   * Útil em testes; em produção, deixe o padrão.
   */
  now?: number | Date;
}

/**
 * Assina a identidade do usuário logado para o widget do bFocus — **v2, com validade**.
 *
 * Devolve `"v2.<ts>.<hex>"`: `ts` = segundos unix inteiros do instante (padrão: agora) e `hex` =
 * hex minúsculo de `HMAC-SHA256(secret, "v2:" + ts + ":" + userExternalId + ":" + customerExternalId)`
 * (UTF-8). A API aceita a assinatura de 7 dias atrás até 5 minutos à frente: gere a cada
 * renderização da página, nunca guarde. Vai no mesmo lugar da v1 (`userHash` do widget); a v1
 * continua aceita.
 *
 * `userExternalId` não pode ter `:` (é o separador; a API recusa). O id do CLIENTE pode.
 * Rode **no seu backend** — o `secret` do widget nunca pode ir para o navegador. Local, sem rede.
 *
 * @example
 * ```ts
 * import { signWidgetIdentityV2 } from "@bfocus/sdk";
 * const userHash = signWidgetIdentityV2(process.env.BFOCUS_WIDGET_SECRET!, "app-77", "erp-1042");
 * // "v2.1789000000.36d26c05…"
 * ```
 */
export function signWidgetIdentityV2(
  secret: string,
  userExternalId: string,
  customerExternalId: string,
  options: SignWidgetIdentityV2Options = {},
): string {
  for (const [name, value] of [
    ["secret", secret],
    ["userExternalId", userExternalId],
    ["customerExternalId", customerExternalId],
  ] as const) {
    if (typeof value !== "string" || value === "") {
      throw new TypeError(`bFocus: \`${name}\` é obrigatório (string não vazia).`);
    }
  }
  if (userExternalId.includes(":")) {
    throw new TypeError(
      `bFocus: \`userExternalId\` não pode ter ":" na assinatura v2 (é o separador): ${JSON.stringify(userExternalId)}`,
    );
  }
  const ts = unixSeconds(options?.now);
  return `v2.${ts}.${createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`v2:${ts}:${userExternalId}:${customerExternalId}`, "utf8")
    .digest("hex")}`;
}

function unixSeconds(now: number | Date | undefined): number {
  let seconds: number;
  if (now === undefined) seconds = Date.now() / 1000;
  else if (now instanceof Date) seconds = now.getTime() / 1000;
  else if (typeof now === "number") seconds = now;
  else throw new TypeError("bFocus: `now` deve ser Date ou segundos unix (number).");
  if (!Number.isFinite(seconds)) throw new TypeError("bFocus: `now` inválido.");
  if (seconds < 0) throw new TypeError("bFocus: `now` não pode ser negativo.");
  return Math.floor(seconds);
}
