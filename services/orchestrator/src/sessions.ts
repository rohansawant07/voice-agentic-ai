import type { ModelMessage } from "ai";
import { bus } from "./bus.js";
import { runOrchestrator } from "./orchestrator.js";

// Session history — in-memory for M1/M2; Redis lands with M4/M5 (README §4).
const sessions = new Map<string, ModelMessage[]>();

/**
 * One conversation turn: append the user message, run the orchestrator,
 * persist history. Shared by /api/chat (text) and /voice (STT transcript).
 */
export async function runTurn(
  sessionId: string,
  userMessage: string,
): Promise<string> {
  const history = sessions.get(sessionId) ?? [];
  if (history.length === 0) {
    bus.emit({ type: "session_started", sessionId, ts: Date.now() });
  }
  history.push({ role: "user", content: userMessage });
  const text = await runOrchestrator(sessionId, history);
  history.push({ role: "assistant", content: text });
  sessions.set(sessionId, history);
  return text;
}
