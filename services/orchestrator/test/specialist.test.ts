import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyNotes } from "../src/specialist.js";

test("notes keep each sentence once, in order", () => {
  const loop = "Note: the JetBlue fare is refundable. Fare rules show it is refundable. ".repeat(400);
  assert.equal(tidyNotes(`Demo inventory. ${loop}`), "Demo inventory. Note: the JetBlue fare is refundable. Fare rules show it is refundable.");
});

test("long notes stop at a sentence boundary", () => {
  const notes = Array.from({ length: 60 }, (_, i) => `Caveat number ${i} applies here.`).join(" ");
  const out = tidyNotes(notes);
  assert.ok(out.length <= 800);
  assert.match(out, /^Caveat number 0 .*applies here\.$/);
});

test("ordinary notes are unchanged", () => {
  const notes = "Fares are round trip. Check bags cost $41 on JetBlue.";
  assert.equal(tidyNotes(notes), notes);
});
