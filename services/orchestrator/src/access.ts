import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

/** Only trusted gateway traffic may carry identity in proxy mode. */
export function registerAccess(app: FastifyInstance): void {
  const mode = process.env.AUTH_MODE ?? "none";
  if (process.env.NODE_ENV === "production" && mode !== "proxy")
    throw new Error("Production requires AUTH_MODE=proxy");
  if (mode !== "proxy") return;
  const token = process.env.GATEWAY_TOKEN ?? "";
  if (token.length < 32)
    throw new Error("GATEWAY_TOKEN must contain at least 32 characters");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  app.addHook("onRequest", async (req, reply) => {
    if (
      req.url.split("?")[0] === "/healthz" ||
      req.url.split("?")[0] === "/readyz"
    )
      return;
    const supplied = req.headers["x-roam-gateway"];
    const user = req.headers["x-roam-user"];
    if (
      typeof supplied !== "string" ||
      !timingSafeEqual(digest(supplied), digest(token)) ||
      typeof user !== "string" ||
      !/^[a-zA-Z0-9_.-]{1,64}$/.test(user)
    )
      return reply.code(401).send({ error: "unauthorized" });
    // Namespace all session IDs by authenticated gateway identity; never trust caller ownership.
    const prefix = createHash("sha256").update(user).digest("hex");
    req.headers["x-roam-owner"] = prefix;
  });
  app.addHook("preValidation", async (req, reply) => {
    const owner = req.headers["x-roam-owner"];
    if (typeof owner !== "string") return;
    const body = req.body as { sessionId?: unknown } | undefined;
    const query = req.query as { sessionId?: unknown };
    const incoming = req.method === "POST" ? body?.sessionId : query.sessionId;
    if (typeof incoming !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(incoming))
      return reply.code(400).send({ error: "valid_session_required" });
    const scoped = `${owner}:${incoming}`;
    if (req.method === "POST" && body) body.sessionId = scoped;
    else query.sessionId = scoped;
  });
}
