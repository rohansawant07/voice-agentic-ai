import { bus } from "./bus.js";
import { runOrchestrator } from "./orchestrator.js";
import { SessionStore } from "./session-store.js";

const sessions = new SessionStore(runOrchestrator, (sessionId) => {
  bus.emit({ type: "session_started", sessionId, ts: Date.now() });
});

/** Shared by HTTP and voice, including the per-session concurrency guard. */
export const runTurn = sessions.runTurn.bind(sessions);
