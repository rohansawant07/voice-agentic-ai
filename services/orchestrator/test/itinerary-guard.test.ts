import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItineraryAgentOutput } from "@concierge/core";
import { guardItinerary, hasItineraryContent, matchListing, tripRange, type ItineraryEvidence } from "../src/itinerary-guard.js";

const listings = ["Lake George Steamboat Company", "Gooney Golf", "Pirate's Cove Adventure Golf", "Mario's Restaurant", "Casa Blanca"];
const evidence: ItineraryEvidence = { listings, closed: ["Great Escape"], webEvidence: false, start: "2026-11-26", end: "2026-11-28" };
const stop = (title: string) => ({ timeOfDay: "morning" as const, title, description: "From the listing." });
const day = (date: string, ...titles: string[]) => ({ dayLabel: date, date, stops: titles.map(stop) });

test("listing titles: exact, retitled, merged and invented stops", () => {
  assert.equal(matchListing("the lake george steamboat company", listings), "Lake George Steamboat Company");
  assert.equal(matchListing("Lake George Steamboat Company Cruise", listings), "Lake George Steamboat Company");
  assert.equal(matchListing("Thanksgiving dinner at Mario's Restaurant", listings), "Mario's Restaurant");
  assert.equal(matchListing("Casa Blanca museum", listings), "Casa Blanca");
  assert.equal(matchListing("Pirate's Cove Adventure Golf or Gooney Golf", listings), undefined);
  assert.equal(matchListing("Arrival & Scenic Drive", listings), undefined);
});

test("guard renames retitled stops, drops unlisted and closed ones, and notes removals", () => {
  const data: ItineraryAgentOutput = {
    days: [
      { ...day("2026-11-26", "Lake George Steamboat Company Cruise", "Arrival & Scenic Drive", "Great Escape"), mealPick: "Mario's Restaurant (Wikivoyage listing; confirm hours)" },
      { ...day("2026-11-27", "Pirate's Cove Adventure Golf or Gooney Golf"), mealPick: "Dinner with ambiance" },
    ],
    notes: "Community listings.",
  };
  const out = guardItinerary(data, evidence);
  assert.equal(out.days?.length, 1);
  assert.deepEqual(out.days?.[0].stops.map((s) => s.title), ["Lake George Steamboat Company"]);
  assert.equal(out.days?.[0].mealPick, "Mario's Restaurant (Wikivoyage listing; confirm hours)");
  assert.match(out.notes ?? "", /^Community listings\. Removed 3 stop\(s\).*Arrival & Scenic Drive.*Removed 1 day\(s\) left without sourced stops\.$/);
});

test("web evidence keeps extra stops but never closed places", () => {
  const out = guardItinerary({ days: [day("2026-11-26", "Arrival & Scenic Drive", "Great Escape")] }, { ...evidence, webEvidence: true });
  assert.deepEqual(out.days?.[0].stops.map((s) => s.title), ["Arrival & Scenic Drive"]);
});

test("days outside the trip, duplicates and extra days are removed", () => {
  const out = guardItinerary({
    days: ["2026-11-25", "2026-11-26", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].map((d) => day(d, "Gooney Golf")),
  }, evidence);
  assert.deepEqual(out.days?.map((d) => d.date), ["2026-11-26", "2026-11-27", "2026-11-28"]);
  assert.match(out.notes ?? "", /Removed 3 day\(s\) outside the trip dates\./);
});

test("no listings means titles are not enforced; empty results are not usable", () => {
  const data = { days: [day("2026-11-26", "Anything")] };
  assert.deepEqual(guardItinerary(data, { listings: [], closed: [], webEvidence: false }), data);
  assert.equal(hasItineraryContent({ notes: "summary only" }), false);
  assert.equal(hasItineraryContent({ destinations: [{ destination: "Savannah, GA", pitch: "Squares" }] }), true);
  assert.deepEqual(tripRange({ startDate: "2026-12-04", endDate: "2026-12-06" }), { start: "2026-12-04", end: "2026-12-06" });
  assert.deepEqual(tripRange({ dates: "Dec 4-6" }), { start: undefined, end: undefined });
});
