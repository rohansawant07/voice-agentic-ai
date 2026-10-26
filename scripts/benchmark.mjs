/* global fetch, WebSocket, AbortSignal, console */
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";

/** Small serial smoke benchmark. --live makes paid model requests; no voice calls. */
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const option = (key, fallback) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const base = option("--base", "http://localhost:8080");
const web = option("--web", "http://localhost:3000");
const runs = Number(option("--runs", "3"));
const output = option("--output", "docs/benchmarks/latest.json");
if (!Number.isInteger(runs) || runs < 1 || runs > 20)
  throw new Error("--runs must be 1..20");
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (q) =>
    sorted.length
      ? Math.round(sorted[Math.ceil(q * sorted.length) - 1] * 100) / 100
      : null;
  return {
    n: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    minMs: sorted[0] ?? null,
    maxMs: sorted.at(-1) ?? null,
  };
};
const report = {
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  concurrency: 1,
  note: "Warm local development processes; fresh sessions; no browser rendering, voice, token usage or load/capacity measurement. Nearest-rank percentiles; small samples are descriptive only.",
  probes: [],
  scenarios: [],
};
for (const [name, url] of [
  ["web", web],
  ["orchestrator", `${base}/healthz`],
  ["travel", "http://localhost:8101/healthz"],
  ["weather", "http://localhost:8102/healthz"],
  ["agency", "http://localhost:8103/healthz"],
]) {
  const samples = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    await res.arrayBuffer();
    if (!res.ok) throw new Error(`${name} probe failed: ${res.status}`);
    if (i > 0) samples.push(performance.now() - start);
  }
  report.probes.push({ name, samplesMs: samples, ...summarize(samples) });
}
report.voiceCapabilities = await (await fetch(`${base}/healthz`)).json();
const scenarios = [
  [
    "clarification",
    "I want a trip in the US. Please ask one short clarifying question; do not research destinations yet.",
  ],
  [
    "regional-itinerary",
    "Build a brief one-day itinerary for Harpers Ferry, WV for two adults. No flights, hotel or budget needed.",
  ],
  [
    "multi-specialist",
    "Plan a three-night San Juan trip for two adults from JFK, November 13–16, 2026, under $2000 total. Compare flights and hotels and create a brief itinerary. No car and no booking or holds.",
  ],
];
if (args.includes("--live"))
  for (const [name, prompt] of scenarios) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const id = `bench-${randomUUID()}`;
      const ws = new WebSocket(
        `${base.replace(/^http/, "ws")}/ws?sessionId=${id}`,
      );
      let start, timer;
      const events = [];
      ws.addEventListener("message", ({ data }) => {
        const event = JSON.parse(String(data));
        if (start !== undefined)
          events.push({
            type: event.type,
            elapsedMs: performance.now() - start,
            agentId: event.agentId,
            tool: event.tool,
            status: event.status,
            durationMs: event.durationMs,
          });
      });
      try {
        await new Promise((resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("WebSocket connection timeout")),
            10000,
          );
          ws.addEventListener(
            "open",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          ws.addEventListener(
            "error",
            () => {
              clearTimeout(timer);
              reject(new Error("WebSocket connection failed"));
            },
            { once: true },
          );
        });
        start = performance.now();
        const res = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: id, message: prompt }),
          signal: AbortSignal.timeout(180000),
        });
        const body = await res.json();
        const sample = {
          httpStatus: res.status,
          elapsedMs: performance.now() - start,
          replyCharacters: typeof body.text === "string" ? body.text.length : 0,
          events,
        };
        sample.firstDelegationMs =
          events.find((e) => e.type === "delegation_started")?.elapsedMs ??
          null;
        sample.firstResultMs =
          events.find(
            (e) => e.type === "delegation_finished" && e.status === "ok",
          )?.elapsedMs ?? null;
        sample.serverRunMs =
          events.find((e) => e.type === "run_finished")?.durationMs ?? null;
        sample.specialistFailures = events.filter(
          (e) => e.type === "delegation_finished" && e.status !== "ok",
        ).length;
        samples.push(sample);
        console.log(
          `${name} ${i + 1}/${runs}: HTTP ${res.status}, ${(sample.elapsedMs / 1000).toFixed(2)}s, ${sample.specialistFailures} specialist failures`,
        );
      } catch (error) {
        samples.push({
          error: error.message,
          elapsedMs: start === undefined ? null : performance.now() - start,
          events,
        });
        console.log(`${name} ${i + 1}/${runs}: ${error.message}`);
      } finally {
        clearTimeout(timer);
        ws.close();
      }
    }
    report.scenarios.push({
      name,
      prompt,
      samples,
      successes: samples.filter((s) => s.httpStatus === 200).length,
      latency: summarize(
        samples.filter((s) => s.httpStatus === 200).map((s) => s.elapsedMs),
      ),
      firstDelegation: summarize(
        samples
          .filter((s) => s.firstDelegationMs != null)
          .map((s) => s.firstDelegationMs),
      ),
      firstResult: summarize(
        samples
          .filter((s) => s.firstResultMs != null)
          .map((s) => s.firstResultMs),
      ),
    });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
report.finishedAt = new Date().toISOString();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Saved ${output}`);
