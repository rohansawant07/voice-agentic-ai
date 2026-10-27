import { test } from "node:test";
import assert from "node:assert/strict";
import { searchAirbnb, airbnbSearchUrl } from "../src/airbnb.js";
import { destinationGuide } from "../src/guides.js";

// Provider-path tests use injected responses, never the network.
process.env.AIRBNB_SEARCH_MODE = "live";

const query = { destination: "Harpers Ferry, WV", checkIn: "2026-11-06", checkOut: "2026-11-08", adults: 2, children: 1, pets: 1, maxNightlyUSD: 200 };

test("Airbnb link preserves dates and party outside mock hotel inventory", () => {
  const url = new URL(airbnbSearchUrl(query));
  assert.equal(url.hostname, "www.airbnb.com");
  assert.equal(decodeURIComponent(url.pathname), "/s/Harpers Ferry, WV/homes");
  for (const [key, value] of Object.entries({ checkin: "2026-11-06", checkout: "2026-11-08", adults: "2", children: "1", pets: "1", price_max: "200" })) {
    assert.equal(url.searchParams.get(key), value);
  }
});

test("invalid dates and reversed stays never call the provider", async () => {
  let called = false;
  for (const dates of [{ checkIn: "2026-02-30" }, { checkOut: query.checkIn }, { checkOut: "yesterday" }]) {
    await assert.rejects(searchAirbnb({ ...query, ...dates }, async () => { called = true; }));
  }
  assert.equal(called, false);
});

test("blocked, empty, malformed and failed providers yield honest links", async () => {
  for (const call of [
    async () => ({ isError: true, content: [{ type: "text", text: "blocked" }] }),
    async () => ({ content: [{ type: "text", text: JSON.stringify({ searchResults: [] }) }] }),
    async () => ({ content: [{ type: "text", text: "invalid" }] }),
    async () => { throw new Error("timeout"); },
  ]) {
    const result = await searchAirbnb(query, call);
    assert.equal(result.status, "search_link_only");
    assert.equal(result.availabilityVerified, false);
    assert.deepEqual(result.listings, []);
    assert.match(result.note, /Do not invent/);
    assert.equal(result.searchUrl, airbnbSearchUrl(query));
  }
});

test("live listings retain original price labels and reject invalid IDs", async () => {
  const result = await searchAirbnb(query, async (args) => {
    assert.equal(args.ignoreRobotsText, false);
    assert.equal(args.children, 1);
    return { content: [{ type: "text", text: JSON.stringify({ searchResults: [
      { id: "12345", url: "https://evil.example", demandStayListing: { description: "Cabin" }, structuredDisplayPrice: { primaryLine: { accessibilityLabel: "$400 for 2 nights" } } },
      { id: "undefined", demandStayListing: { description: "Broken listing" } },
    ] }) }] };
  });
  assert.equal(result.status, "live_results");
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0]?.priceText, "$400 for 2 nights");
  assert.equal(new URL(result.listings[0]!.url).hostname, "www.airbnb.com");
  assert.equal(result.availabilityVerified, false);
});

test("both requested regions have official planning facts without hotel inventory", async () => {
  const noResults = (async () => Response.json({ query: { search: [] } })) as unknown as typeof fetch;
  for (const destination of ["Harpers Ferry, WV", "Harper's Ferry, West Virginia", "Shenandoah Valley, VA", "Shenandoah National Park"]) {
    const guide = await destinationGuide(destination, noResults);
    assert.equal(guide.source, "curated-official-guide");
    assert.ok(guide.activities.length >= 3);
    assert.ok(guide.activities.every((activity) => !("cost" in activity)));
  }
  assert.equal((await destinationGuide("Unknown Village", noResults)).source, "unavailable");
});


test("links mode skips the provider entirely", async () => {
  process.env.AIRBNB_SEARCH_MODE = "links";
  try {
    let called = false;
    const result = await searchAirbnb(query, async () => { called = true; });
    assert.equal(called, false);
    assert.equal(result.status, "search_link_only");
    assert.equal(result.searchUrl, airbnbSearchUrl(query));
  } finally { process.env.AIRBNB_SEARCH_MODE = "live"; }
});
