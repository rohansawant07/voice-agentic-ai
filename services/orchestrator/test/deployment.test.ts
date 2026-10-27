import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import Fastify from "fastify";
import { registerAccess } from "../src/access.js";
import { PostgresSessionStore } from "../src/postgres-session-store.js";
import { PostgresBus } from "../src/postgres-bus.js";
import { SessionBusyError, CapacityError } from "../src/session-store.js";

const pool = process.env.TEST_DATABASE_URL
  ? new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  : null;
after(async () => {
  await pool?.end();
});

test("gateway authentication rejects forged identity and scopes session ownership", async (t) => {
  const previous = {
    mode: process.env.AUTH_MODE,
    token: process.env.GATEWAY_TOKEN,
  };
  process.env.AUTH_MODE = "proxy";
  process.env.GATEWAY_TOKEN = "a".repeat(64);
  const app = Fastify();
  registerAccess(app);
  app.post("/api/chat", async (req) => req.body);
  t.after(async () => {
    await app.close();
    if (previous.mode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previous.mode;
    if (previous.token === undefined) delete process.env.GATEWAY_TOKEN;
    else process.env.GATEWAY_TOKEN = previous.token;
  });
  const request = {
    method: "POST" as const,
    url: "/api/chat",
    payload: { sessionId: "same-id", message: "hello" },
  };
  assert.equal((await app.inject(request)).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        ...request,
        headers: { "x-roam-user": "alice", "x-roam-gateway": "wrong" },
      })
    ).statusCode,
    401,
  );
  const headers = {
    "x-roam-user": "alice",
    "x-roam-gateway": "a".repeat(64),
    "x-roam-owner": "forged",
  };
  const alice = await app.inject({ ...request, headers });
  const bob = await app.inject({
    ...request,
    headers: { ...headers, "x-roam-user": "bob" },
  });
  assert.equal(alice.statusCode, 200);
  assert.equal(bob.statusCode, 200);
  assert.notEqual(alice.json().sessionId, bob.json().sessionId);
  assert.match(alice.json().sessionId, /^[a-f0-9]{64}:same-id$/);
  assert.equal(
    (
      await app.inject({
        ...request,
        payload: { sessionId: "../../bad" },
        headers,
      })
    ).statusCode,
    400,
  );
});

test(
  "Postgres: shared locks, failed-turn rollback, restart persistence, capacity and cross-instance replay",
  { skip: !pool },
  async () => {
    const db = pool!;
    await db.query(
      await readFile(
        new URL("../migrations/001-state.sql", import.meta.url),
        "utf8",
      ),
    );
    const id = `test-${randomUUID()}`;
    let release!: (text: string) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = new PostgresSessionStore(
      db,
      async () => {
        started();
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
      undefined,
      1,
    );
    const second = new PostgresSessionStore(
      db,
      async () => "other",
      undefined,
      1,
    );
    const inFlight = first.runTurn(id, "first");
    await ready;
    await assert.rejects(second.runTurn(id, "overlap"), SessionBusyError);
    await assert.rejects(
      second.runTurn(`${id}-other`, "capacity"),
      CapacityError,
    );
    release("reply");
    await inFlight;
    const failing = new PostgresSessionStore(db, async () => {
      throw new Error("provider unavailable");
    });
    await assert.rejects(failing.runTurn(id, "failed"), /provider unavailable/);
    const restarted = new PostgresSessionStore(db, async (_id, history) => {
      assert.deepEqual(history, [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "retry" },
      ]);
      return "recovered";
    });
    await restarted.runTurn(id, "retry");
    const writer = new PostgresBus(db),
      reader = new PostgresBus(db);
    await writer.emit({
      type: "assistant_message",
      sessionId: id,
      ts: Date.now(),
      text: "persisted event",
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Replay timeout"));
      }, 3000);
      const unsubscribe = reader.subscribe(id, (event) => {
        try {
          assert.equal(event.type, "assistant_message");
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          unsubscribe();
          reject(e);
        }
      });
    });
    await db.query("DELETE FROM roam_events WHERE session_id=$1", [id]);
    await db.query("DELETE FROM roam_sessions WHERE id=$1", [id]);
  },
);
