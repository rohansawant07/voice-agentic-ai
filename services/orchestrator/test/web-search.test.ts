import { test } from "node:test";
import assert from "node:assert/strict";
import { webTools, type WebSource } from "../src/web-search.js";

const options = { toolCallId: "test", messages: [] };
test("web research preserves citations, marks unverified inventory, and bounds per-run calls", async () => {
  let calls = 0;
  const run = async () => { calls++; return { text: "Park hours", sources: [{ url: "https://www.nps.gov/", title: "NPS" }, { url: "javascript:alert(1)" }] }; };
  const collected: WebSource[] = [];
  const tools = webTools(run, true, collected);
  const execute = tools.search_web.execute!;
  const first = await execute({ query: "park hours" }, options);
  assert.equal((first as {status:string}).status, "ok");
  assert.deepEqual((first as {sources:unknown}).sources, [{ url: "https://www.nps.gov/", title: "NPS" }]);
  assert.equal((first as {inventoryVerified:boolean}).inventoryVerified, false);
  await execute({ query: "park hours" }, options);
  assert.equal((await execute({ query: "park hours" }, options) as {reason:string}).reason, "search_budget_exhausted");
  assert.equal(calls, 2);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].url, "https://www.nps.gov/");
  assert.ok(!Number.isNaN(Date.parse(collected[0].retrievedAt)));
  await webTools(run, true).search_web.execute!({ query: "park hours" }, options);
  assert.equal(calls, 3);
});
test("disabled search, missing citations and provider errors fail honestly without leaking errors", async () => {
  assert.deepEqual(webTools(undefined, false), {});
  const missing = webTools(async () => ({ text: "Unsupported", sources: [] }), true);
  assert.equal((await missing.search_web.execute!({ query: "hours" }, options) as {reason:string}).reason, "no_citable_sources");
  const failed = webTools(async () => { throw new Error("secret provider detail"); }, true);
  const result = await failed.search_web.execute!({ query: "hours" }, options);
  assert.equal((result as {reason:string}).reason, "web_search_failed");
  assert.ok(!JSON.stringify(result).includes("secret provider"));
});
