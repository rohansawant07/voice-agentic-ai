/* global WebSocket, console */
/** Synthetic/consented WAV fixture only. Uses paid STT and model requests. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout, clearTimeout } from "node:timers";
import process from "node:process";
const args = process.argv.slice(2);
const opt = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const file = opt("--audio");
if (!file) throw new Error("Supply --audio path/to/consented-or-synthetic.wav");
const audio = await readFile(file);
const runs = Number(opt("--runs", "3"));
if (!Number.isInteger(runs) || runs < 1 || runs > 20)
  throw new Error("--runs must be 1..20");
const base = opt("--base", "http://localhost:8080");
const output = opt("--output", "docs/benchmarks/voice-latest.json");
const report = {
  startedAt: new Date().toISOString(),
  node: process.version,
  concurrency: 1,
  fixture: {
    bytes: audio.length,
    sha256: createHash("sha256").update(audio).digest("hex"),
    mime: "audio/wav",
  },
  note: "Client-observed time from audio_end to transcript/reply, excluding recording time. Full WAV uploaded over loopback. Not first audible speech or pure provider latency. No transcript/reply content is saved.",
  samples: [],
};
for (let i = 0; i < runs; i++) {
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/voice?sessionId=bench-voice-${randomUUID()}`,
  );
  const sample = { events: [] };
  let start, timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Voice request timeout")),
        180000,
      );
      ws.addEventListener("error", () =>
        reject(new Error("Voice socket error")),
      );
      ws.addEventListener("close", () =>
        reject(new Error("Voice socket closed before completion")),
      );
      ws.addEventListener("message", ({ data }) => {
        if (typeof data !== "string") return;
        const message = JSON.parse(data);
        if (message.type === "ready") {
          sample.capabilities = { stt: message.stt, tts: message.tts };
          if (!message.stt) {
            reject(new Error("STT disabled"));
            return;
          }
          ws.send(audio);
          start = performance.now();
          ws.send(JSON.stringify({ type: "audio_end", mime: "audio/wav" }));
          return;
        }
        const elapsedMs = performance.now() - start;
        sample.events.push({ type: message.type, elapsedMs });
        if (message.type === "transcript") sample.transcriptMs = elapsedMs;
        if (message.type === "reply") {
          sample.replyMs = elapsedMs;
          resolve();
        }
        if (message.type === "error") reject(new Error(message.message));
      });
    });
    console.log(
      `voice ${i + 1}/${runs}: transcript ${(sample.transcriptMs / 1000).toFixed(2)}s, reply ${(sample.replyMs / 1000).toFixed(2)}s`,
    );
  } catch (error) {
    sample.error = error.message;
    console.log(`voice ${i + 1}/${runs}: ${error.message}`);
  } finally {
    clearTimeout(timer);
    ws.close();
    report.samples.push(sample);
  }
}
report.finishedAt = new Date().toISOString();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Saved ${output}`);
