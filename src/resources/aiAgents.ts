import { encodeSegment } from "../core.js";
import type { RequestOptions, Transport } from "../core.js";
import type { AiAgent, AiAgentPreview, AiAgentPreviewParams } from "../types.js";

const agentPath = (agentId: string) => `/ai-agents/${encodeSegment(agentId, "agentId")}`;

/** Agentes de IA — `bf.aiAgents`. */
export class AiAgents {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Lista os agentes de IA. `GET /ai-agents` */
  list(options?: RequestOptions): Promise<AiAgent[]> {
    return this.#t.data({ method: "GET", path: "/ai-agents" }, options);
  }

  /** Busca um agente pelo id (uuid). `GET /ai-agents/{agent_id}` */
  get(agentId: string, options?: RequestOptions): Promise<AiAgent> {
    return this.#t.data({ method: "GET", path: agentPath(agentId) }, options);
  }

  /**
   * Simula a resposta do agente a uma mensagem (consome IA do tenant; nada é enviado a
   * cliente algum). `POST /ai-agents/{agent_id}/preview`
   */
  preview(
    agentId: string,
    message: string,
    params: AiAgentPreviewParams = {},
    options?: RequestOptions,
  ): Promise<AiAgentPreview> {
    const body: Record<string, unknown> = { message };
    if (params.history !== undefined) body["history"] = params.history;
    return this.#t.data({ method: "POST", path: `${agentPath(agentId)}/preview`, body }, options);
  }
}
