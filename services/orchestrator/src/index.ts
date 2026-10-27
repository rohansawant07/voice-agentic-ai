import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { registerChatRoute } from "./chat-route.js";
import { bus } from "./bus.js";
import { connectMcp, mcpReady } from "./mcp.js";
import { runTurn } from "./sessions.js";
import { registerVoiceRoute } from "./voice/route.js";
import { sttEnabled } from "./voice/stt.js";
import { ttsEnabled } from "./voice/tts.js";

import { initializeDatabase, database, expireState } from "./database.js";
import { registerAccess } from "./access.js";

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

const app = Fastify({
  logger: {
    redact: ["req.headers.authorization", "req.headers.x-roam-gateway"],
  },
  bodyLimit: 32768,
});
registerAccess(app);
await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
await app.register(cors, { origin: [WEB_ORIGIN] });

app.get("/healthz", async () => ({
  ok: true,
  service: "orchestrator",
  voice: { stt: sttEnabled(), tts: ttsEnabled() },
}));
app.get("/readyz", async (_req, reply) => {
  if (database) {
    try {
      await database.query("SELECT 1");
    } catch {
      return reply.code(503).send({ ready: false });
    }
  }
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
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  });
  socket.on("close", unsubscribe);
});

/** Text-in / text-out loop (M1). Voice (/voice WS) wraps the same runTurn. */
registerChatRoute(app, runTurn, async (sessionId) => {
  await bus.emit({
    type: "error",
    sessionId,
    ts: Date.now(),
    message: "orchestrator run failed",
  });
});

/** Spoken round-trip (M2): binary audio in, TTS audio out. */
registerVoiceRoute(app, originAllowed);

await initializeDatabase();
await connectMcp();
const cleanup = setInterval(
  () => void expireState().catch(() => app.log.warn("state cleanup failed")),
  60000,
);
cleanup.unref();
app.addHook("onClose", async () => {
  clearInterval(cleanup);
  await database?.end();
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ port: PORT, host: HOST });
console.log(`[orchestrator] listening on ${HOST}:${PORT}`);
