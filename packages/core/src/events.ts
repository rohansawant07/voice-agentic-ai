import type { DelegationStatus } from "./types.js";

/**
 * WebSocket events streamed from orchestrator to the web client
 * (README §4, DESIGN.md §5.2 Agents tab + Results canvas).
 */

export interface SessionEventBase {
  sessionId: string;
  /** epoch ms, stamped by the orchestrator */
  ts: number;
}

export type SessionEvent =
  | (SessionEventBase & { type: "session_started" })
  | (SessionEventBase & { type: "transcript_partial"; text: string })
  | (SessionEventBase & { type: "transcript_final"; text: string })
  | (SessionEventBase & {
      type: "delegation_started";
      agentId: string;
      task: string;
    })
  | (SessionEventBase & {
      type: "tool_called";
      agentId: string;
      tool: string;
      /** args with sensitive values masked */
      argsPreview: Record<string, unknown>;
    })
  | (SessionEventBase & {
      type: "delegation_finished";
      agentId: string;
      status: DelegationStatus;
      summary: string;
      data?: unknown;
      durationMs: number;
    })
  | (SessionEventBase & {
      type: "confirmation_required";
      action: string;
      consequence: string;
    })
  | (SessionEventBase & { type: "assistant_message"; text: string })
  | (SessionEventBase & { type: "run_finished"; durationMs: number })
  | (SessionEventBase & { type: "error"; message: string });

export type SessionEventType = SessionEvent["type"];
