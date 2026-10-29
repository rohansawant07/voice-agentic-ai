import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceIssueFor } from "../src/lib/session";

test("voice socket errors become plain messages instead of failing silently", () => {
  assert.match(voiceIssueFor("empty transcript"), /didn't catch that/);
  assert.match(voiceIssueFor("no audio received"), /didn't catch that/);
  assert.match(voiceIssueFor("turn already in progress or rate limited"), /few seconds/);
  assert.match(voiceIssueFor("stt_failed"), /couldn't transcribe/);
  assert.match(voiceIssueFor("run_failed"), /couldn't complete/);
  assert.match(voiceIssueFor("something new"), /didn't work that time/);
  assert.match(voiceIssueFor(), /didn't work that time/);
});
