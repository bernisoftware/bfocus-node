/** Servidor HTTP local (node:http) que grava cada requisição e responde o que o teste mandar. */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
  method: string;
  /** Caminho cru, exatamente como veio no fio (sem a query). */
  path: string;
  /** Pares da query, na ordem, já decodificados. */
  queryPairs: [string, string][];
  headers: http.IncomingHttpHeaders;
  rawBody: string;
  /** Corpo JSON decodificado; `null` quando não houve corpo. */
  body: unknown;
}

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  /** string = corpo cru (text/plain); outro valor = JSON; `undefined` = vazio. */
  body?: unknown;
}

/** `"hang"` = nunca responde (para testar timeout). */
export type Handler = (req: Recorded) => Reply | "hang" | Promise<Reply | "hang">;

export interface TestServer {
  url: string;
  requests: Recorded[];
  setHandler(handler: Handler): void;
  reset(): void;
  close(): Promise<void>;
}

export async function startServer(initial: Handler = () => ({ status: 500 })): Promise<TestServer> {
  let handler = initial;
  const requests: Recorded[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const rawUrl = req.url ?? "/";
      const q = rawUrl.indexOf("?");
      const path = q === -1 ? rawUrl : rawUrl.slice(0, q);
      const queryPairs = q === -1 ? [] : [...new URLSearchParams(rawUrl.slice(q + 1)).entries()];
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      if (rawBody !== "") {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      }
      const recorded: Recorded = { method: req.method ?? "", path, queryPairs, headers: req.headers, rawBody, body };
      requests.push(recorded);

      const reply = await handler(recorded);
      if (reply === "hang") return;
      const headers: Record<string, string> = { ...(reply.headers ?? {}) };
      let payload = "";
      if (typeof reply.body === "string") {
        payload = reply.body;
        headers["Content-Type"] ??= "text/plain; charset=utf-8";
      } else if (reply.body !== undefined) {
        payload = JSON.stringify(reply.body);
        headers["Content-Type"] ??= "application/json";
      }
      res.writeHead(reply.status, headers);
      res.end(payload);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    setHandler(next) {
      handler = next;
    },
    reset() {
      requests.length = 0;
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** Uma porta livre em que ninguém escuta (conexão recusada). */
export async function closedPort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const { port } = s.address() as AddressInfo;
  await new Promise((resolve) => s.close(resolve));
  return port;
}
