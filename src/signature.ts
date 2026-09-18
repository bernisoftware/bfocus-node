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
