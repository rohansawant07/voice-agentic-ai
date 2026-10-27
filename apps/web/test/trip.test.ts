import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentActivity, ChatMessage } from "../src/lib/session";
import {
  deriveTrip,
  flightTags,
  hotelTags,
  pickedTotal,
  planText,
} from "../src/lib/trip";

const usd = (amount: number) => ({ amount, currency: "USD" as const });

const flight = (id: string, fare: number, durationMinutes: number) => ({
  id,
  carrier: "Spirit",
  flightNumber: `NK${id}`,
  origin: "JFK",
  destination: "SJU",
  departLocal: "2026-03-13T10:15:00",
  arriveLocal: "2026-03-13T13:00:00",
  durationMinutes,
  stops: 0,
  fare: usd(fare),
  fareClass: "Main",
  holdAvailable: false,
});

const hotel = (id: string, total: number, reviewScore: number) => ({
  id,
  name: `Hotel ${id}`,
  starRating: 4,
  reviewScore,
  neighborhood: "Condado",
  pricePerNight: usd(total / 3),
  totalForStay: usd(total),
  amenities: ["wifi"],
  distanceNote: "5 min walk to beach",
});

function agents(): Map<string, AgentActivity> {
  return new Map<string, AgentActivity>([
    [
      "flight-agent",
      {
        agentId: "flight-agent",
        state: "done",
        task: "",
        startedAt: 0,
        tools: [
          {
            tool: "search_flights",
            ts: 1,
            argsPreview: {
              origin: "JFK",
              destination: "SJU",
              date: "2026-03-13",
              returnDate: "2026-03-16",
              passengers: 2,
            },
          },
        ],
        data: { options: [flight("a", 174, 200), flight("b", 263, 150)] },
      },
    ],
    [
      "hotel-agent",
      {
        agentId: "hotel-agent",
        state: "done",
        task: "",
        startedAt: 0,
        tools: [],
        data: { options: [hotel("x", 594, 4.8), hotel("y", 276, 4.0)] },
      },
    ],
  ]);
}

const said = (text: string): ChatMessage[] => [{ role: "user", text }];

test("derives route, dates, travelers and the stated budget", () => {
  const trip = deriveTrip(agents(), said("Long weekend under $1,800 please"));
  assert.equal(trip.route, "JFK → SJU");
  assert.equal(trip.dates, "Mar 13 – Mar 16");
  assert.equal(trip.travelers, 2);
  assert.equal(trip.budgetCap, 1800);
});

test("reads shorthand budgets and ignores assistant prices", () => {
  const messages: ChatMessage[] = [
    { role: "user", text: "Somewhere warm for $2k" },
    { role: "assistant", text: "Flights start at $174" },
  ];
  assert.equal(deriveTrip(agents(), messages).budgetCap, 2000);
  assert.equal(deriveTrip(agents(), said("No budget yet")).budgetCap, undefined);
});

test("multiplies per-person fares by travelers and sums picks", () => {
  const trip = deriveTrip(agents(), []);
  const picked = pickedTotal(trip, { flight: "a", hotel: "y", car: null });
  assert.deepEqual(
    picked.lines.map((l) => l.amount),
    [348, 276],
  );
  assert.equal(picked.total, 624);
  assert.equal(pickedTotal(trip, { flight: "gone", hotel: null, car: null }).total, 0);
});

test("tags only describe the options shown", () => {
  const trip = deriveTrip(agents(), []);
  const f = flightTags(trip.flights!.options);
  assert.deepEqual(f.get("a"), ["Cheapest"]);
  assert.deepEqual(f.get("b"), ["Fastest"]);
  const h = hotelTags(trip.hotels!.options);
  assert.deepEqual(h.get("x"), ["Top rated"]);
  assert.deepEqual(h.get("y"), ["Lowest price"]);
  assert.equal(flightTags([flight("solo", 100, 100)]).get("solo")?.length, 0);
});

test("copied plan labels prices as unbooked estimates", () => {
  const trip = deriveTrip(agents(), []);
  const text = planText(trip, { flight: "a", hotel: null, car: null });
  assert.match(text, /JFK → SJU/);
  assert.match(text, /sample prices, not booked/);
  assert.match(text, /Estimated total: \$348/);
  assert.match(text, /Verify prices and availability before booking/);
});
