import { test } from "node:test";
import assert from "node:assert/strict";
import { flightLinks, hotelLinks, spellOutPlace } from "../src/lib/links";

test("spellOutPlace expands US state and territory codes only", () => {
  assert.equal(spellOutPlace("San Juan, PR"), "San Juan, Puerto Rico");
  assert.equal(spellOutPlace("Portland, me"), "Portland, Maine");
  assert.equal(spellOutPlace("Lake George, New York"), "Lake George, New York");
  assert.equal(spellOutPlace("Paris, XX"), "Paris, XX");
});

test("flightLinks builds round-trip searches on each site", () => {
  const links = flightLinks({
    source: "google_flights", origin: "JFK,LGA,EWR", destination: "SJU",
    departDate: "2026-03-13", returnDate: "2026-03-16", passengers: 2,
  });
  assert.deepEqual(links.map((l) => l.site), ["Skyscanner", "Google Flights", "Booking.com"]);
  assert.equal(links[0]!.url, "https://www.skyscanner.com/transport/flights/jfk/sju/260313/260316/?adultsv2=2&cabinclass=economy");
  assert.equal(
    new URL(links[1]!.url).searchParams.get("q"),
    "Flights to SJU from JFK on 2026-03-13 through 2026-03-16 for 2 adults",
  );
  const booking = new URL(links[2]!.url);
  assert.equal(booking.pathname, "/flights/JFK.AIRPORT-SJU.AIRPORT/");
  assert.equal(booking.searchParams.get("type"), "ROUNDTRIP");
  assert.equal(booking.searchParams.get("return"), "2026-03-16");
});

test("flightLinks drops a return date that isn't after departure", () => {
  const [skyscanner, , booking] = flightLinks({
    source: "demo", origin: "BOS", destination: "MCO", departDate: "2026-03-13", returnDate: "2026-03-10", passengers: 1,
  });
  assert.equal(skyscanner!.url, "https://www.skyscanner.com/transport/flights/bos/mco/260313/?adultsv2=1&cabinclass=economy");
  assert.equal(new URL(booking!.url).searchParams.get("type"), "ONEWAY");
  assert.equal(new URL(booking!.url).searchParams.has("return"), false);
});

test("flightLinks refuses fields that aren't airport codes or dates", () => {
  const base = { source: "demo" as const, origin: "JFK", destination: "SJU", departDate: "2026-03-13", passengers: 1 };
  assert.deepEqual(flightLinks({ ...base, origin: "New York" }), []);
  assert.deepEqual(flightLinks({ ...base, destination: "SJU/../evil" }), []);
  assert.deepEqual(flightLinks({ ...base, departDate: "March 13" }), []);
});

test("hotelLinks encodes the destination and dates", () => {
  const [booking, google] = hotelLinks({
    source: "google_hotels", destination: "Savannah, GA", checkIn: "2026-04-03", checkOut: "2026-04-05", guests: 2,
  });
  const url = new URL(booking!.url);
  assert.equal(url.origin + url.pathname, "https://www.booking.com/searchresults.html");
  assert.equal(url.searchParams.get("ss"), "Savannah, Georgia");
  assert.equal(url.searchParams.get("checkin"), "2026-04-03");
  assert.equal(url.searchParams.get("group_adults"), "2");
  assert.match(new URL(google!.url).searchParams.get("q")!, /^Hotels in Savannah, Georgia from 2026-04-03 to 2026-04-05/);
  assert.deepEqual(hotelLinks({ source: "demo", destination: "X", checkIn: "2026-04-05", checkOut: "2026-04-03", guests: 2 }), []);
});
