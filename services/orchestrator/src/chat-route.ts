import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SessionBusyError, CapacityError } from "./session-store.js";

const ChatInput = z.object({
  sessionId: z.string().trim().min(1).max(160).optional(),
  message: z.string().trim().min(1).max(8000),
});

type RunTurn = (sessionId: string, message: string) => Promise<string>;

export function registerChatRoute(
  app: FastifyInstance,
  runTurn: RunTurn,
  onFailure: (sessionId: string) => void | Promise<void> = () => {},
): void {
  app.post("/api/chat", async (req, reply) => {
    const parsed = ChatInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const { message, sessionId = randomUUID() } = parsed.data;
    try {
      const text = await runTurn(sessionId, message);
      return { sessionId, text };
    } catch (err) {
      if (err instanceof SessionBusyError) {
        return reply.code(409).send({ sessionId, error: "session_busy" });
      }
      if (err instanceof CapacityError)
        return reply.code(429).send({ error: "server_busy" });
      req.log.error(err);
      await onFailure(sessionId);
      return reply.code(500).send({ sessionId, error: "run_failed" });
    }
  });
}
