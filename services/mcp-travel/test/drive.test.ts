import { test } from "node:test";
import assert from "node:assert/strict";
import { driveTimes, formatDuration, geocodePlace } from "../src/drive.js";

// Injected geocoder and router responses, never the network.
const PLACES: Record<string, { name: string; latitude: number; longitude: number; admin1: string }[]> = {
  "New York": [{ name: "New York", latitude: 40.71427, longitude: -74.00597, admin1: "New York" }],
  Lenox: [
    { name: "Lenox", latitude: 40.88165, longitude: -94.56191, admin1: "Iowa" },
    { name: "Lenox", latitude: 42.35648, longitude: -73.28483, admin1: "Massachusetts" },
  ],
  "Harpers Ferry": [{ name: "Harpers Ferry", latitude: 39.32538, longitude: -77.73888, admin1: "West Virginia" }],
  Honolulu: [{ name: "Honolulu", latitude: 21.30694, longitude: -157.85833, admin1: "Hawaii" }],
};

function fakeServices(osrm: (url: URL) => Response | Promise<Response>, calls: URL[] = []): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "geocoding-api.open-meteo.com")
      return Response.json({ results: PLACES[url.searchParams.get("name")!] });
    return osrm(url);
  }) as typeof fetch;
}

// Durations/distances from a live OSRM table call, NYC → Lenox MA, Harpers Ferry WV.
const table = (url: URL) => {
  const columns = url.pathname.split("/").pop()!.split(";").length;
  const durations = [0, 12925.9, 18999.8, null].slice(0, columns);
  const distances = [0, 226115.7, 414551.6, null].slice(0, columns);
  return Response.json({ code: "Ok", durations: [durations], distances: [distances] });
};

test("drive times are routed from the origin in one table call", async () => {
  const calls: URL[] = [];
  const result = await driveTimes(
    { origin: "NYC", destinations: ["Lenox, MA", "Harpers Ferry, WV"], minHours: 4, maxHours: 5.5 },
    fakeServices(table, calls),
  );
  assert.equal(result.source, "osrm");
  assert.equal(result.origin, "New York, New York");
  assert.equal(result.trafficIncluded, false);
  assert.deepEqual(result.drives, [
    { destination: "Lenox, MA", resolvedAs: "Lenox, Massachusetts", minutes: 215, miles: 141, label: "3 h 35 min", withinWindow: false },
    { destination: "Harpers Ferry, WV", resolvedAs: "Harpers Ferry, West Virginia", minutes: 317, miles: 258, label: "5 h 17 min", withinWindow: true },
  ]);
  const route = calls.find((u) => u.hostname === "router.project-osrm.org")!;
  assert.equal(route.pathname, "/table/v1/driving/-74.00597,40.71427;-73.28483,42.35648;-77.73888,39.32538");
  assert.equal(route.searchParams.get("sources"), "0");
  assert.equal(calls.filter((u) => u.hostname === "router.project-osrm.org").length, 1);
});

test("unknown places and unroutable drives are flagged, never estimated", async () => {
  const result = await driveTimes(
    { origin: "New York, NY", destinations: ["Lenox, MA", "Atlantis, NY", "Honolulu, HI"] },
    fakeServices((url) => {
      assert.equal(url.pathname.split(";").length, 3, "unknown places are not routed");
      return Response.json({ code: "Ok", durations: [[0, 12925.9, null]], distances: [[0, 226115.7, null]] });
    }),
  );
  assert.equal(result.window, undefined);
  assert.equal(result.drives[0]!.withinWindow, undefined, "no window, no verdict");
  assert.deepEqual(result.drives.slice(1), [
    { destination: "Atlantis, NY", error: "place_not_found" },
    { destination: "Honolulu, HI", resolvedAs: "Honolulu, Hawaii", error: "no_road_route" },
  ]);
});

test("routing outages and timeouts fail gracefully", async () => {
  for (const osrm of [
    () => new Response("busy", { status: 429 }),
    () => Response.json({ code: "InvalidQuery" }),
    () => { throw new DOMException("timed out", "TimeoutError"); },
  ]) {
    const result = await driveTimes({ origin: "New York, NY", destinations: ["Lenox, MA"], maxHours: 5 }, fakeServices(osrm));
    assert.equal(result.source, "unavailable");
    assert.deepEqual(result.drives, []);
    assert.match(result.note, /Do not estimate drive times/);
  }
  const lost = await driveTimes({ origin: "Atlantis", destinations: ["Lenox, MA"] }, fakeServices(table));
  assert.equal(lost.source, "unavailable");
  assert.match(lost.note, /origin/);
});

test("geocoding honors the requested state", async () => {
  const fake = fakeServices(table);
  assert.equal((await geocodePlace("Lenox, Massachusetts", fake))?.label, "Lenox, Massachusetts");
  assert.equal(await geocodePlace("Lenox, TX", fake), null);
  assert.equal(formatDuration(240), "4 h");
  assert.equal(formatDuration(45), "45 min");
});
