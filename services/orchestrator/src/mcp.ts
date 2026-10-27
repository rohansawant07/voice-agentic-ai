import { createMCPClient } from "@ai-sdk/mcp";
import type { McpServerName } from "@concierge/core";
import type { ToolSet } from "ai";

const URLS: Record<McpServerName, string> = {
  "mcp-travel": process.env.MCP_TRAVEL_URL ?? "http://localhost:8101/mcp",
  "mcp-weather": process.env.MCP_WEATHER_URL ?? "http://localhost:8102/mcp",
  "mcp-agency": process.env.MCP_AGENCY_URL ?? "http://localhost:8103/mcp",
};

const toolsets = new Map<McpServerName, ToolSet>();

/** Connect to all MCP servers at startup; toolsets are cached per server. */
export async function connectMcp(): Promise<void> {
  await Promise.all(
    (Object.keys(URLS) as McpServerName[]).map(async (name) => {
      const client = await createMCPClient({
        transport: { type: "http", url: URLS[name] },
      });
      toolsets.set(name, await client.tools());
      console.log(
        `[orchestrator] connected ${name} (${Object.keys(toolsets.get(name) ?? {}).length} tools)`,
      );
    }),
  );
}

export function mcpReady(): boolean {
  return toolsets.size === Object.keys(URLS).length;
}

/** Tools for one specialist, scoped to its registry-declared servers and tool allowlist. */
export function toolsFor(servers: McpServerName[], allow?: string[]): ToolSet {
  const merged: ToolSet = {};
  for (const s of servers) Object.assign(merged, toolsets.get(s) ?? {});
  if (!allow) return merged;
  return Object.fromEntries(Object.entries(merged).filter(([name]) => allow.includes(name)));
}
