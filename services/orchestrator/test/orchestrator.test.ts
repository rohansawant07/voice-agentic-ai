import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MockLanguageModelV4 } from "ai/test";
import type { SessionEvent } from "@concierge/core";
import { runOrchestrator, TIMEOUT_REPLY, TURN_TIMEOUT_MS } from "../src/orchestrator.js";
import { SPECIALIST_TIMEOUT_MS } from "../src/specialist.js";
import { bus } from "../src/bus.js";

/** A model that never answers: it waits for the turn's abort signal. */
const hanging = () =>
  new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        // AbortSignal.timeout does not keep the process alive; this timer does until the abort.
        const alive = setTimeout(() => {}, 10_000);
        abortSignal?.addEventListener("abort", () => {
          clearTimeout(alive);
          reject(abortSignal.reason);
        });
      }),
  });

test("a turn that runs out of time ends with a spoken apology and a finished run", async () => {
  const sessionId = `timeout-${Date.now()}`;
  const events: SessionEvent[] = [];
  const unsubscribe = bus.subscribe(sessionId, (e) => events.push(e));
  const reply = await runOrchestrator(sessionId, [{ role: "user", content: "Compare five towns." }], undefined, { model: hanging(), timeoutMs: 50 });
  unsubscribe();
  assert.equal(reply, TIMEOUT_REPLY);
  assert.deepEqual(events.map((e) => e.type), ["assistant_message", "run_finished"]);
});

test("other model failures still fail the turn", async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("provider down"); } });
  await assert.rejects(runOrchestrator(`fail-${Date.now()}`, [{ role: "user", content: "Hi" }], undefined, { model }), /provider down/);
});

test("turn limit leaves room for a specialist and stays under the gateway's /api/chat timeout", async () => {
  const gateway = await readFile(new URL("../../../deploy/gateway/default.conf.template", import.meta.url), "utf8");
  const chat = gateway.slice(gateway.indexOf("location = /api/chat"));
  const seconds = Number(chat.match(/proxy_read_timeout (\d+)s;/)?.[1]);
  assert.ok(TURN_TIMEOUT_MS < seconds * 1000, `turn ${TURN_TIMEOUT_MS} ms vs gateway ${seconds} s`);
  assert.ok(SPECIALIST_TIMEOUT_MS + 30_000 <= TURN_TIMEOUT_MS);
});
