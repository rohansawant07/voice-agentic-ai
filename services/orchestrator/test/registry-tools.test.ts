import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AGENT_REGISTRY } from "@concierge/core";

/** Tool names each MCP server registers, read from its source so a typo can't silently drop a tool. */
async function registered(server: string): Promise<Set<string>> {
  const source = await readFile(new URL(`../../${server}/src/index.ts`, import.meta.url), "utf8");
  return new Set([...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]!));
}

test("every specialist has a tool allowlist naming tools its own servers register", async () => {
  for (const def of AGENT_REGISTRY) {
    assert.ok(def.tools?.length, `${def.id} has no tool allowlist`);
    const available = new Set<string>();
    for (const server of def.mcpServers) for (const name of await registered(server)) available.add(name);
    for (const name of def.tools!) assert.ok(available.has(name), `${def.id}: ${name} is not registered by ${def.mcpServers.join(", ")}`);
  }
});

test("destructive tools are only allowlisted for the agents that own them", () => {
  const holders = (tool: string) => AGENT_REGISTRY.filter((d) => d.tools?.includes(tool)).map((d) => d.id);
  assert.deepEqual(holders("hold_booking"), ["flight-agent"]);
  assert.deepEqual(holders("cancel_booking"), ["support-agent"]);
  assert.deepEqual(holders("modify_booking"), ["support-agent"]);
});
