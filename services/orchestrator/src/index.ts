import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import { bus } from "./bus.js";
import { connectMcp, mcpReady } from "./mcp.js";
import { runOrchestrator } from "./orchestrator.js";

const PORT = Number(process.env.PORT ?? 8080);

// Session history — in-memory for M1; Redis lands with M4/M5 (README §4).
const sessions = new Map<string, ModelMessage[]>();

const app = Fastify({ logger: true });
await app.register(websocket);

app.get("/healthz", async () => ({ ok: true, service: "orchestrator" }));
app.get("/readyz", async (_req, reply) => {
  if (!mcpReady()) return reply.code(503).send({ ready: false });
  return { ready: true };
});

/** Live agent-activity feed (DESIGN.md §5.2): /ws?sessionId=... */
app.get("/ws", { websocket: true }, (socket, req) => {
  const sessionId = (req.query as { sessionId?: string }).sessionId;
  if (!sessionId) {
    socket.close(1008, "sessionId required");
    return;
  }
  const unsubscribe = bus.subscribe(sessionId, (event) => {
    socket.send(JSON.stringify(event));
  });
  socket.on("close", unsubscribe);
});

/** Text-in / text-out loop (M1). Voice wraps this same path in M2. */
app.post("/api/chat", async (req, reply) => {
  const body = req.body as { sessionId?: string; message?: string };
  if (!body?.message?.trim()) {
    return reply.code(400).send({ error: "message required" });
  }
  const sessionId = body.sessionId ?? randomUUID();
  const history = sessions.get(sessionId) ?? [];
  if (history.length === 0) {
    bus.emit({ type: "session_started", sessionId, ts: Date.now() });
  }
  history.push({ role: "user", content: body.message });

  try {
    const text = await runOrchestrator(sessionId, history);
    history.push({ role: "assistant", content: text });
    sessions.set(sessionId, history);
    return { sessionId, text };
  } catch (err) {
    req.log.error(err);
    bus.emit({
      type: "error",
      sessionId,
      ts: Date.now(),
      message: "orchestrator run failed",
    });
    return reply.code(500).send({ sessionId, error: "run_failed" });
  }
});

await connectMcp();
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[orchestrator] listening on :${PORT}`);
