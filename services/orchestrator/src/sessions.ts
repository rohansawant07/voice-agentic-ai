import { bus } from "./bus.js";
import { runOrchestrator } from "./orchestrator.js";
import { database } from "./database.js";
import { PostgresSessionStore } from "./postgres-session-store.js";
import { SessionStore } from "./session-store.js";

const onStart = async (sessionId: string) => {
  await bus.emit({ type: "session_started", sessionId, ts: Date.now() });
};
const sessions = database
  ? new PostgresSessionStore(database, runOrchestrator, onStart)
  : new SessionStore(runOrchestrator, onStart);

/** Shared by HTTP and voice, including the per-session concurrency guard. */
export const runTurn = sessions.runTurn.bind(sessions);
