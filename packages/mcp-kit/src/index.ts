import express from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Serve an MCP server over stateless streamable HTTP at /mcp, with
 * /healthz (liveness) and /readyz (readiness) per README §6.
 * A fresh server instance per request keeps the transport stateless,
 * which is what lets these scale horizontally on K8s.
 */
export function serveMcp(opts: {
  name: string;
  port: number;
  createServer: () => McpServer;
  ready?: () => Promise<boolean> | boolean;
}): void {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: opts.name });
  });

  app.get("/readyz", async (_req, res) => {
    const ready = opts.ready ? await opts.ready() : true;
    res.status(ready ? 200 : 503).json({ ready });
  });

  app.post("/mcp", async (req, res) => {
    const server = opts.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[${opts.name}] request failed`, err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless mode: GET/DELETE session endpoints are not applicable
  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(opts.port, () => {
    console.log(`[${opts.name}] MCP on :${opts.port}/mcp`);
  });
}

/** Wrap a JSON-serializable result as an MCP tool text response. */
export function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/** Deterministic 32-bit hash → [0,1) PRNG seed helper for mock data. */
export function seededRandom(seedText: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    // xorshift32 — deterministic, good enough for mock data
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}
