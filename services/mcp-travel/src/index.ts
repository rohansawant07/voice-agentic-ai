import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serveMcp, toolResult, seededRandom } from "@concierge/mcp-kit";
import {
  CARRIERS,
  DESTINATIONS,
  FARE_CLASSES,
  destinationByQuery,
} from "./data.js";

const PORT = Number(process.env.PORT ?? 8101);

// hold_booking writes here — audit record for destructive-action evals
const auditLog: { ts: string; action: string; detail: unknown }[] = [];

function mockFlights(origin: string, destination: string, date: string, pax: number) {
  const rand = seededRandom(`${origin}|${destination}|${date}`);
  const count = 3 + Math.floor(rand() * 3);
  return Array.from({ length: count }, (_, i) => {
    const carrier = CARRIERS[Math.floor(rand() * CARRIERS.length)]!;
    const stops = rand() < 0.55 ? 0 : 1;
    const durationMinutes = 150 + Math.floor(rand() * 240) + stops * 95;
    const departHour = 6 + Math.floor(rand() * 15);
    const base = 120 + rand() * 320 + stops * -40;
    const fare = Math.round((base + (pax - 1) * 0) * (carrier.code === "NK" ? 0.7 : 1));
    const depart = `${date}T${String(departHour).padStart(2, "0")}:${rand() < 0.5 ? "15" : "40"}:00`;
    const arriveMs = new Date(depart).getTime() + durationMinutes * 60_000;
    return {
      id: `${carrier.code}-${1000 + Math.floor(rand() * 900)}-${date}-${i}`,
      carrier: carrier.name,
      flightNumber: `${carrier.code}${1000 + Math.floor(rand() * 900)}`,
      origin,
      destination,
      departLocal: depart,
      arriveLocal: new Date(arriveMs).toISOString().slice(0, 19),
      durationMinutes,
      stops,
      fare: { amount: fare, currency: "USD" as const },
      fareClass: FARE_CLASSES[Math.floor(rand() * 2)]!,
      holdAvailable: rand() < 0.7,
    };
  }).sort((a, b) => a.fare.amount - b.fare.amount);
}

function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-travel", version: "0.1.0" });

  server.registerTool(
    "search_flights",
    {
      description:
        "Search US domestic + territory flights for a date. Returns fare, stops, duration, hold availability. Prices are per person, round-trip if returnDate given.",
      inputSchema: {
        origin: z.string().describe("IATA code or city, e.g. JFK or New York"),
        destination: z.string().describe("IATA code or city, e.g. SJU or San Juan"),
        date: z.string().describe("Departure date, YYYY-MM-DD"),
        returnDate: z.string().optional(),
        passengers: z.number().int().min(1).max(9).default(1),
      },
    },
    async ({ origin, destination, date, returnDate, passengers }) => {
      const dest = destinationByQuery(destination);
      const destCode = dest?.code ?? destination.toUpperCase().slice(0, 3);
      const originCode = origin.length === 3 ? origin.toUpperCase() : "JFK";
      let flights = mockFlights(originCode, destCode, date, passengers);
      if (returnDate) {
        flights = flights.map((f) => ({
          ...f,
          fare: { amount: Math.round(f.fare.amount * 1.85), currency: "USD" as const },
        }));
      }
      return toolResult({
        roundTrip: Boolean(returnDate),
        perPersonUSD: true,
        flights,
      });
    },
  );

  server.registerTool(
    "get_fare_rules",
    {
      description: "Fare rules (changes, refunds, bags) for a flight option id.",
      inputSchema: { flightId: z.string() },
    },
    async ({ flightId }) => {
      const rand = seededRandom(flightId);
      return toolResult({
        flightId,
        changeable: rand() < 0.7,
        changeFeeUSD: rand() < 0.5 ? 0 : 75,
        refundable: rand() < 0.3,
        carryOnIncluded: rand() < 0.8,
        checkedBagUSD: Math.round(30 + rand() * 15),
      });
    },
  );

  server.registerTool(
    "hold_booking",
    {
      description:
        "DESTRUCTIVE: place a 24h hold on a flight option. Only call after the customer has explicitly confirmed.",
      inputSchema: {
        flightId: z.string(),
        passengers: z.number().int().min(1).max(9),
        customerId: z.string(),
        confirmed: z.boolean().describe("Must be true — customer said yes"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ flightId, passengers, customerId, confirmed }) => {
      if (!confirmed) {
        return toolResult({
          error: "confirmation_required",
          message: "Customer must explicitly confirm before a hold is placed.",
        });
      }
      const holdId = `HOLD-${seededRandom(flightId + customerId)().toString(36).slice(2, 8).toUpperCase()}`;
      auditLog.push({
        ts: new Date().toISOString(),
        action: "hold_booking",
        detail: { flightId, passengers, customerId, holdId },
      });
      return toolResult({ holdId, expiresInHours: 24, status: "held" });
    },
  );

  server.registerTool(
    "search_hotels",
    {
      description:
        "Search hotels/stays in a US destination by dates, guests, and optional max nightly budget.",
      inputSchema: {
        destination: z.string(),
        checkIn: z.string().describe("YYYY-MM-DD"),
        checkOut: z.string().describe("YYYY-MM-DD"),
        guests: z.number().int().min(1).max(8).default(2),
        maxNightlyUSD: z.number().optional(),
      },
    },
    async ({ destination, checkIn, checkOut, guests, maxNightlyUSD }) => {
      const dest = destinationByQuery(destination);
      if (!dest) return toolResult({ hotels: [], note: `No inventory for "${destination}"` });
      const nights = Math.max(
        1,
        Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000),
      );
      const rand = seededRandom(`${dest.code}|${checkIn}`);
      const hotels = dest.hotels
        .map((h) => {
          const nightly = Math.round(h.base * (0.9 + rand() * 0.35) * (guests > 2 ? 1.2 : 1));
          return {
            id: `${dest.code}-${h.name.replace(/\W+/g, "-").toLowerCase()}`,
            name: h.name,
            starRating: h.star,
            reviewScore: Math.round((3.7 + rand() * 1.2) * 10) / 10,
            neighborhood: h.neighborhood,
            pricePerNight: { amount: nightly, currency: "USD" as const },
            totalForStay: { amount: nightly * nights, currency: "USD" as const },
            amenities: ["wifi", "pool", "breakfast", "gym"].slice(0, 2 + Math.floor(rand() * 2)),
            distanceNote: dest.beach
              ? `${2 + Math.floor(rand() * 12)} min walk to beach`
              : `${2 + Math.floor(rand() * 15)} min to center`,
          };
        })
        .filter((h) => !maxNightlyUSD || h.pricePerNight.amount <= maxNightlyUSD)
        .sort((a, b) => b.reviewScore - a.reviewScore);
      return toolResult({ destination: dest.city, nights, hotels });
    },
  );

  server.registerTool(
    "get_hotel_details",
    {
      description: "Details for a hotel id returned by search_hotels.",
      inputSchema: { hotelId: z.string() },
    },
    async ({ hotelId }) => {
      const rand = seededRandom(hotelId);
      return toolResult({
        hotelId,
        checkInTime: "15:00",
        checkOutTime: "11:00",
        cancellable: rand() < 0.8,
        cancelDeadlineDaysBefore: 2,
        resortFeeUSD: rand() < 0.4 ? Math.round(20 + rand() * 30) : 0,
        parkingUSD: rand() < 0.5 ? Math.round(15 + rand() * 30) : 0,
      });
    },
  );

  server.registerTool(
    "search_activities",
    {
      description:
        "Things to do in a US destination, optionally filtered by kind (beach, outdoors, culture, food, family).",
      inputSchema: {
        destination: z.string(),
        kind: z.string().optional(),
      },
    },
    async ({ destination, kind }) => {
      const dest = destinationByQuery(destination);
      if (!dest) return toolResult({ activities: [] });
      const activities = dest.activities
        .filter((a) => !kind || a.kind === kind)
        .map((a) => ({ ...a, costUSD: a.cost }));
      return toolResult({ destination: dest.city, activities });
    },
  );

  server.registerTool(
    "convert_currency",
    {
      description: "Convert an amount between USD and major currencies (fixed demo rates).",
      inputSchema: {
        amount: z.number(),
        from: z.string().describe("e.g. USD"),
        to: z.string().describe("e.g. EUR"),
      },
    },
    async ({ amount, from, to }) => {
      const perUSD: Record<string, number> = { USD: 1, EUR: 0.91, GBP: 0.78, CAD: 1.36, MXN: 17.2, JPY: 149 };
      const f = perUSD[from.toUpperCase()];
      const t = perUSD[to.toUpperCase()];
      if (!f || !t) return toolResult({ error: "unsupported_currency" });
      return toolResult({
        amount,
        from: from.toUpperCase(),
        to: to.toUpperCase(),
        converted: Math.round((amount / f) * t * 100) / 100,
      });
    },
  );

  server.registerTool(
    "list_destinations",
    {
      description:
        "List the US + territory destinations this agency has inventory for (use to ground suggestions).",
      inputSchema: {},
    },
    async () =>
      toolResult(
        DESTINATIONS.map((d) => ({
          code: d.code,
          city: d.city,
          region: d.region,
          beach: d.beach,
        })),
      ),
  );

  return server;
}

serveMcp({ name: "mcp-travel", port: PORT, createServer });
