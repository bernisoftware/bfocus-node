/** O pacote construído importa em ESM (`import`) e em CJS (`require`), com tipos e zero deps. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import * as esm from "@bfocus/sdk";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, any>;
const require = createRequire(import.meta.url);

const RUNTIME_EXPORTS = [
  "AuthenticationError",
  "Bfocus",
  "BfocusError",
  "ConflictError",
  "DEFAULT_BASE_URL",
  "NetworkError",
  "NotFoundError",
  "PermissionDeniedError",
  "RateLimitError",
  "ServerError",
  "VERSION",
  "ValidationError",
  "signWidgetIdentity",
];
const VECTOR = ["bf_whs_x", "USR-1", "ACME-1", "9a15d2527b855a048094ea7826c3b0f16ae5db3035ac3537324d45007ef15141"] as const;

function runNode(args: string[]): string {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `node ${args.join(" ")} falhou:\n${r.stderr}`);
  return r.stdout.trim();
}

describe("pacote", () => {
  it("ESM: import expõe a API pública", () => {
    assert.deepEqual(Object.keys(esm).sort(), RUNTIME_EXPORTS);
    assert.equal(esm.signWidgetIdentity(VECTOR[0], VECTOR[1], VECTOR[2]), VECTOR[3]);
  });

  it("CJS: require resolve para dist/cjs e expõe a mesma API", () => {
    const resolved = require.resolve("@bfocus/sdk");
    assert.ok(resolved.endsWith(["dist", "cjs", "index.js"].join(sep)), resolved);
    const cjs = require("@bfocus/sdk") as typeof esm;
    const keys = Object.keys(cjs).filter((k) => k !== "__esModule" && k !== "default").sort();
    assert.deepEqual(keys, RUNTIME_EXPORTS);
    assert.notEqual(cjs.Bfocus, esm.Bfocus, "require deve carregar o build CJS, não o ESM");
    assert.equal(cjs.VERSION, esm.VERSION);
    const client = new cjs.Bfocus({ apiKey: "k" });
    assert.ok(client.kb.articles);
    assert.ok(new cjs.NotFoundError({ code: "X", status: 404 }) instanceof cjs.BfocusError);
    assert.equal(cjs.signWidgetIdentity(VECTOR[0], VECTOR[1], VECTOR[2]), VECTOR[3]);
  });

  it("processos Node reais: require() e import() do nome do pacote", () => {
    assert.equal(
      runNode(["-e", "const s=require('@bfocus/sdk'); console.log(typeof s.Bfocus, s.VERSION)"]),
      `function ${PKG.version}`,
    );
    assert.equal(
      runNode([
        "--input-type=module",
        "-e",
        "import { Bfocus, VERSION } from '@bfocus/sdk'; console.log(typeof Bfocus, VERSION)",
      ]),
      `function ${PKG.version}`,
    );
  });

  it("dist/cjs é marcado como CommonJS e os dois builds têm .d.ts", () => {
    assert.deepEqual(JSON.parse(readFileSync(new URL("../dist/cjs/package.json", import.meta.url), "utf8")), {
      type: "commonjs",
    });
    for (const f of ["dist/esm/index.d.ts", "dist/cjs/index.d.ts", "dist/esm/index.js", "dist/cjs/index.js"]) {
      assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), f);
    }
  });

  it("manifesto: exports types/import/require, files, engines, MIT e zero dependências", () => {
    assert.equal(PKG.name, "@bfocus/sdk");
    assert.equal(PKG.license, "MIT");
    assert.equal(PKG.engines.node, ">=18");
    assert.deepEqual(PKG.files, ["dist", "README.md", "LICENSE"]);
    assert.deepEqual(PKG.exports["."], {
      import: { types: "./dist/esm/index.d.ts", default: "./dist/esm/index.js" },
      require: { types: "./dist/cjs/index.d.ts", default: "./dist/cjs/index.js" },
    });
    assert.equal(Object.keys(PKG.dependencies ?? {}).length, 0, "zero dependências de runtime");
    assert.deepEqual(Object.keys(PKG.devDependencies).sort(), ["@types/node", "typescript"]);
  });
});
