// Versão da SDK. Bumpada pelo scripts/release-sdks.sh junto com o package.json
// (test/unit.test.ts trava a igualdade entre os dois).
//
// Não é cosmética: vai no header X-Bfocus-Client de toda requisição, e é por ele que a
// API sabe quem avisar quando uma correção exige atualizar a SDK.
export const VERSION = '0.1.0';

/** Identificação enviada em `X-Bfocus-Client` (e `User-Agent`). */
export const CLIENT_ID = `bfocus-node/${VERSION}`;
