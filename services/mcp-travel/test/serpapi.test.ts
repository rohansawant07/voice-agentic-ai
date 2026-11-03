import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFlights, liveHotels, serpApiKey } from "../src/serpapi.js";

const reply = (body: unknown, status = 200) => {
  const calls: URL[] = [];
  const fetch = (async (url: URL) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};

const segment = (from: string, to: string, depart: string, arrive: string, airline: string, number: string) => ({
  departure_airport: { name: from, id: from, time: depart },
  arrival_airport: { name: to, id: to, time: arrive },
  duration: 100,
  airline,
  flight_number: number,
  travel_class: "Economy",
});

test("serpApiKey is off when unset or blank", () => {
  assert.equal(serpApiKey({}), undefined);
  assert.equal(serpApiKey({ SERPAPI_API_KEY: "  " }), undefined);
  assert.equal(serpApiKey({ SERPAPI_API_KEY: " k " }), "k");
});

test("liveFlights maps Google Flights itineraries and searches one adult", async () => {
  const { calls, fetch } = reply({
    best_flights: [{
      flights: [segment("JFK", "SJU", "2026-03-13 7:05", "2026-03-13 11:10", "JetBlue", "B6 1003")],
      total_duration: 245, price: 312.4,
    }],
    other_flights: [
      {
        flights: [
          segment("JFK", "MIA", "2026-03-13 6:00", "2026-03-13 9:05", "American", "AA 1"),
          segment("MIA", "SJU", "2026-03-13 10:30", "2026-03-13 13:20", "American", "AA 2"),
        ],
        total_duration: 440, price: 280,
      },
      { flights: [], total_duration: 10, price: 1 },
      { flights: [segment("JFK", "SJU", "2026-03-13 9:00", "2026-03-13 13:00", "Delta", "DL 5")], total_duration: 240 },
    ],
  });
  const flights = await liveFlights({ origin: "JFK", destination: "SJU", date: "2026-03-13", returnDate: "2026-03-16" }, { key: "secret", fetch });
  assert.equal(flights.length, 2, "itineraries without segments or a price are dropped");
  assert.deepEqual(flights[0], {
    id: "gf-2026-03-13-0-B61003",
    carrier: "JetBlue",
    flightNumber: "B61003",
    origin: "JFK",
    destination: "SJU",
    departLocal: "2026-03-13T07:05:00",
    arriveLocal: "2026-03-13T11:10:00",
    durationMinutes: 245,
    stops: 0,
    fare: { amount: 312, currency: "USD" },
    fareClass: "Economy",
    holdAvailable: false,
  });
  assert.equal(flights[1]!.stops, 1);
  assert.equal(flights[1]!.destination, "SJU");
  assert.equal(flights[1]!.flightNumber, "AA1, AA2");
  const params = calls[0]!.searchParams;
  assert.equal(params.get("engine"), "google_flights");
  assert.equal(params.get("adults"), "1");
  assert.equal(params.get("type"), "1");
  assert.equal(params.get("return_date"), "2026-03-16");
});

test("liveFlights reports SerpApi errors without the key or URL", async () => {
  const { fetch } = reply({ error: "Invalid API key." }, 401);
  await assert.rejects(
    liveFlights({ origin: "JFK", destination: "SJU", date: "2026-03-13" }, { key: "secret", fetch }),
    (error: Error) => error.message === "Invalid API key." && !error.message.includes("secret"),
  );
});

test("liveHotels keeps priced hotels and leaves out missing stars and ratings", async () => {
  const { calls, fetch } = reply({
    properties: [
      { type: "hotel", name: "La Concha", property_token: "Ch-1", rate_per_night: { extracted_lowest: 210.6 },
        total_rate: { extracted_lowest: 690 }, extracted_hotel_class: 4, overall_rating: 4.3,
        amenities: ["Pool", "Wi-Fi", "Bar", "Spa", "Gym"], images: [{ thumbnail: "https://lh3.googleusercontent.com/a" }] },
      { type: "hotel", name: "Plain Inn", rate_per_night: { extracted_lowest: 99 } },
      { type: "vacation rental", name: "Villa", rate_per_night: { extracted_lowest: 300 } },
      { type: "hotel", name: "No price" },
      { type: "hotel", name: "Too dear", rate_per_night: { extracted_lowest: 900 } },
    ],
  });
  const hotels = await liveHotels({ destination: "San Juan, PR", checkIn: "2026-03-13", checkOut: "2026-03-16", guests: 2, maxNightlyUSD: 400 }, 3, { key: "k", fetch });
  assert.deepEqual(hotels.map((h) => h.name), ["La Concha", "Plain Inn"]);
  assert.deepEqual(hotels[0], {
    id: "gh-Ch1", name: "La Concha", photoUrl: "https://lh3.googleusercontent.com/a", starRating: 4, reviewScore: 4.3,
    pricePerNight: { amount: 211, currency: "USD" }, totalForStay: { amount: 690, currency: "USD" },
    amenities: ["Pool", "Wi-Fi", "Bar", "Spa"],
  });
  assert.equal("starRating" in hotels[1]!, false);
  assert.equal("reviewScore" in hotels[1]!, false);
  assert.equal(hotels[1]!.totalForStay.amount, 297, "falls back to nightly x nights");
  assert.equal(calls[0]!.searchParams.get("q"), "hotels in San Juan, PR");
  assert.equal(calls[0]!.searchParams.get("max_price"), "400");
});
