import type { z } from "zod";

/** MCP servers a specialist may draw tools from (README §3). */
export type McpServerName = "mcp-travel" | "mcp-weather" | "mcp-agency";

/**
 * A specialist agent in the static registry (README §2.2).
 * The orchestrator can only delegate to registered agents.
 */
export interface AgentDefinition {
  /** e.g. "flight-agent" */
  id: string;
  /** Shown to the orchestrator — this IS the routing prompt. Write like an API doc. */
  description: string;
  /** The specialist's instructions. */
  systemPrompt: string;
  /** Which MCP servers' tools this agent may use. */
  mcpServers: McpServerName[];
  /** Defaults to SPECIALIST_MODEL. */
  model?: string;
  /** Tool-loop budget. */
  maxSteps: number;
  /** Structured result returned to the orchestrator. Free-text results are a bug. */
  outputSchema: z.ZodTypeAny;
}

/** Delegation contract (README §2.3). */
export interface DelegationRequest {
  /** Natural-language sub-task, self-contained. */
  task: string;
  /** Structured facts already known (dates, origin, budget, customerId). */
  context?: Record<string, unknown>;
}

export type DelegationStatus = "ok" | "failed" | "needs_input";

export interface DelegationResult<T = unknown> {
  sources?: { url: string; title?: string; retrievedAt: string }[];
  status: DelegationStatus;
  /** Validated against the agent's outputSchema when status === "ok". */
  data?: T;
  /** One-sentence plain-text digest the orchestrator can weave into speech. */
  summary: string;
  reason?: string;
  suggestion?: string;
}
