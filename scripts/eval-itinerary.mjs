/* global fetch, AbortSignal */
import process from "node:process";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Itinerary grounding eval (M3). Makes PAID model calls (Haiku specialist +
 * Sonnet judge, roughly $0.25-0.35 per full run; see docs/evals/README.md), so it is
 * deliberately outside `pnpm test` and CI. Starts private MCP servers on
 * ports 8111-8113 so it never collides with a running dev stack.
 *
 *   node scripts/eval-itinerary.mjs [--case id,id] [--skip-calibration] [--output path] [--env path]
 */
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (key, fallback) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const envFile = resolve(option("--env", resolve(root, ".env")));
const output = resolve(
  option("--output", `docs/evals/itinerary-${new Date().toISOString().slice(0, 10)}.json`),
);

// Values never printed; only keys absent from the shell environment are applied.
const fileEnv = {};
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith("#"))
      fileEnv[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
const env = { ...fileEnv, ...process.env };
if (!env.ANTHROPIC_API_KEY)
  throw new Error(`ANTHROPIC_API_KEY missing (looked in the shell and ${envFile}; pass --env)`);

const servers = [
  ["mcp-travel", 8111],
  ["mcp-weather", 8112],
  ["mcp-agency", 8113],
];
const serverEnv = {
  ...env,
  HOST: "127.0.0.1",
  DATABASE_URL: "",
  DESTINATION_GUIDES: env.DESTINATION_GUIDES ?? "wikivoyage",
  WEATHER_PROVIDER: env.WEATHER_PROVIDER ?? "live",
};
const children = servers.map(([name, port]) =>
  spawn(resolve(root, `services/${name}/node_modules/.bin/tsx`), ["src/index.ts"], {
    cwd: resolve(root, `services/${name}`),
    env: { ...serverEnv, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  }),
);
const stop = () => {
  for (const child of children)
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

for (const [name, port] of servers) {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error(`${name} did not become healthy on :${port}`);
}

const evalArgs = ["eval/itinerary.ts", "--output", output];
if (option("--case")) evalArgs.push("--case", option("--case"));
if (args.includes("--skip-calibration")) evalArgs.push("--skip-calibration");
const run = spawn(resolve(root, "services/orchestrator/node_modules/.bin/tsx"), evalArgs, {
  cwd: resolve(root, "services/orchestrator"),
  env: {
    ...serverEnv,
    MCP_TRAVEL_URL: "http://127.0.0.1:8111/mcp",
    MCP_WEATHER_URL: "http://127.0.0.1:8112/mcp",
    MCP_AGENCY_URL: "http://127.0.0.1:8113/mcp",
  },
  stdio: "inherit",
});
run.on("exit", (code) => process.exit(code ?? 1));
