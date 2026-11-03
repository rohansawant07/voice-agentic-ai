import { test } from "node:test";
import assert from "node:assert/strict";
import { isBargeIn, pcmToFloat, voiceIssueFor } from "../src/lib/session";

test("pcmToFloat reads 16-bit little-endian samples, even from an offset view", () => {
  const bytes = new Uint8Array([0xaa, 0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);
  const floats = pcmToFloat(bytes.subarray(1));
  assert.deepEqual([...floats], [0, 0x7fff / 0x8000, -1]);
});

test("barge-in needs two heard words", () => {
  assert.equal(isBargeIn("um"), false);
  assert.equal(isBargeIn("  wait  "), false);
  assert.equal(isBargeIn("wait, stop"), true);
});

test("live conversation problems have their own messages", () => {
  assert.match(voiceIssueFor("still working on the last request"), /still working/);
  assert.match(voiceIssueFor("live voice unavailable"), /isn't available/);
});

test("voice socket errors become plain messages instead of failing silently", () => {
  assert.match(voiceIssueFor("empty transcript"), /didn't catch that/);
  assert.match(voiceIssueFor("no audio received"), /didn't catch that/);
  assert.match(voiceIssueFor("turn already in progress or rate limited"), /few seconds/);
  assert.match(voiceIssueFor("stt_failed"), /couldn't transcribe/);
  assert.match(voiceIssueFor("run_failed"), /couldn't complete/);
  assert.match(voiceIssueFor("something new"), /didn't work that time/);
  assert.match(voiceIssueFor(), /didn't work that time/);
});
