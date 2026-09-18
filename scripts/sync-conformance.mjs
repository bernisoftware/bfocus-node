// Atalho: copia clients/conformance/cases.json para test/conformance/cases.json.
// A fonte da verdade é `python3 clients/conformance/generate.py`, que já escreve esta cópia (e as
// das outras SDKs) e é cobrado pelo `--check`. A cópia existe porque o espelho público
// (bernisoftware/bfocus-node) recebe só clients/node e o publish.yml de lá roda a conformidade.
// No monorepo, a suíte FALHA se a cópia divergir da original.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const source = new URL("../../conformance/cases.json", import.meta.url);
const target = new URL("../test/conformance/cases.json", import.meta.url);

if (!existsSync(source)) {
  console.error("✗ clients/conformance/cases.json não encontrado (rode no monorepo).");
  process.exit(1);
}
mkdirSync(new URL(".", target), { recursive: true });
copyFileSync(source, target);
console.log("✓ test/conformance/cases.json atualizado");
