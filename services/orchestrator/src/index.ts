import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { bus } from "./bus.js";
import { connectMcp, mcpReady } from "./mcp.js";
import { runTurn } from "./sessions.js";
import { registerVoiceRoute } from "./voice/route.js";
import { sttEnabled } from "./voice/stt.js";
import { ttsEnabled } from "./voice/tts.js";

const PORT = Number(process.env.PORT ?? 8080);
// Loopback by default; deployments (containers, EKS) set HOST=0.0.0.0.
const HOST = process.env.HOST ?? "127.0.0.1";
// The only browser origin allowed to call us — the Next.js app.
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

/**
 * WS upgrades bypass CORS entirely, so browser origins must be checked by
 * hand. Absent Origin = non-browser client (curl, websocat, evals) — allowed;
 * the check only defends against drive-by pages in a victim's browser.
 */
function originAllowed(origin: string | undefined): boolean {
  return origin === undefined || origin === WEB_ORIGIN;
}

const app = Fastify({ logger: true });
await app.register(websocket);
await app.register(cors, { origin: [WEB_ORIGIN] });

app.get("/healthz", async () => ({
  ok: true,
  service: "orchestrator",
  voice: { stt: sttEnabled(), tts: ttsEnabled() },
}));
app.get("/readyz", async (_req, reply) => {
  if (!mcpReady()) return reply.code(503).send({ ready: false });
  return { ready: true };
});

/** Live agent-activity feed (DESIGN.md §5.2): /ws?sessionId=... */
app.get("/ws", { websocket: true }, (socket, req) => {
  if (!originAllowed(req.headers.origin)) {
    socket.close(1008, "origin not allowed");
    return;
  }
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

/** Text-in / text-out loop (M1). Voice (/voice WS) wraps the same runTurn. */
app.post("/api/chat", async (req, reply) => {
  const body = req.body as { sessionId?: string; message?: string };
  if (!body?.message?.trim()) {
    return reply.code(400).send({ error: "message required" });
  }
  const sessionId = body.sessionId ?? randomUUID();
  try {
    const text = await runTurn(sessionId, body.message);
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

/** Spoken round-trip (M2): binary audio in, TTS audio out. */
registerVoiceRoute(app, originAllowed);

await connectMcp();
await app.listen({ port: PORT, host: HOST });
console.log(`[orchestrator] listening on ${HOST}:${PORT}`);
