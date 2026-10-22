import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionStore, SessionBusyError } from "../src/session-store.js";
import { registerChatRoute } from "../src/chat-route.js";
import Fastify from "fastify";

test("same-session overlap is rejected; other sessions can proceed", async () => {
  let release!: (value: string) => void;
  const store = new SessionStore(async (id) => id === "a"
    ? new Promise<string>((resolve) => { release = resolve; }) : "other reply");
  const first = store.runTurn("a", "first");
  await assert.rejects(store.runTurn("a", "second"), SessionBusyError);
  assert.equal(await store.runTurn("b", "independent"), "other reply");
  release("first reply");
  assert.equal(await first, "first reply");
});

test("failed turns preserve committed history and release the session", async () => {
  let calls = 0;
  const seen: unknown[] = [];
  const store = new SessionStore(async (_id, messages) => {
    seen.push(structuredClone(messages));
    if (++calls === 2) {
      messages[0]!.content = "mutated";
      throw new Error("provider failed");
    }
    return "reply";
  });
  await store.runTurn("a", "first");
  await assert.rejects(store.runTurn("a", "failed"), /provider failed/);
  await store.runTurn("a", "retry");
  assert.deepEqual(seen[2], [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "retry" },
  ]);
});

test("a failed first turn can be retried without abandoned input", async () => {
  let first = true;
  const store = new SessionStore(async (_id, messages) => {
    if (first) { first = false; throw new Error("offline"); }
    assert.deepEqual(messages, [{ role: "user", content: "retry" }]);
    return "ok";
  });
  await assert.rejects(store.runTurn("a", "abandoned"));
  assert.equal(await store.runTurn("a", "retry"), "ok");
});

test("HTTP rejects malformed input before calling the model", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let calls = 0;
  registerChatRoute(app, async () => { calls++; return "ok"; });
  for (const payload of [{}, { message: 42 }, { message: " " },
    { message: "ok", sessionId: {} }, { message: "ok", sessionId: "" },
    { message: "x".repeat(8001) }]) {
    const response = await app.inject({ method: "POST", url: "/api/chat", payload });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test("HTTP returns conflict for overlap while the first turn succeeds", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let release!: (value: string) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const store = new SessionStore(async () => {
    started();
    return new Promise<string>((resolve) => { release = resolve; });
  });
  registerChatRoute(app, store.runTurn.bind(store));
  const request = { method: "POST" as const, url: "/api/chat", payload: { sessionId: "a", message: "hello" } };
  const first = app.inject(request).then((res) => res);
  await ready;
  const conflict = await app.inject(request);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "session_busy");
  release("hello back");
  assert.equal((await first).statusCode, 200);
});

test("HTTP generates session IDs, trims input, and hides provider errors", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerChatRoute(app, async (id, message) => {
    assert.match(id, /^[a-f0-9-]{36}$/);
    assert.equal(message, "hello");
    throw new Error("private provider details");
  });
  const res = await app.inject({ method: "POST", url: "/api/chat", payload: { message: " hello " } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, "run_failed");
  assert.ok(!res.body.includes("private provider"));
});
