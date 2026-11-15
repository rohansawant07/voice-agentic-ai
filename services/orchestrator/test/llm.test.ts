import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** llm.ts reads its settings at import, so each case loads it in a fresh process. */
const load = (env: Record<string, string>) =>
  execFileSync(
    process.execPath,
    ["--import", "tsx", "-e", 'import("./src/llm.ts").then((m) => console.log(JSON.stringify(m.gatewayTags("flight-agent", undefined, "session:s1") ?? null)))'],
    { env: { ...process.env, LLM_GATEWAY_URL: "", LLM_GATEWAY_KEY: "", ...env }, encoding: "utf8", stdio: "pipe" },
  ).trim();

test("without a gateway, calls carry no gateway tags", () => {
  assert.equal(load({}), "null");
});

test("with a gateway, calls are tagged by agent and session", () => {
  assert.deepEqual(JSON.parse(load({ LLM_GATEWAY_URL: "http://localhost:4000/anthropic/v1", LLM_GATEWAY_KEY: "sk-virtual" })), {
    "x-litellm-tags": "flight-agent,session:s1",
  });
});

test("a gateway URL without its own key refuses to start instead of sending the Anthropic key", () => {
  assert.throws(() => load({ LLM_GATEWAY_URL: "http://localhost:4000/anthropic/v1" }), /LLM_GATEWAY_KEY is not/);
});
