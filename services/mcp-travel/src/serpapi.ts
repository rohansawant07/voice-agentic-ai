import { z } from "zod";

/**
 * Live Google Flights and Google Hotels prices through SerpApi. Active only
 * when SERPAPI_API_KEY is set; without it the tools keep serving demo data.
 * Results are prices to compare, not bookable inventory: Roam never buys.
 */

const ENDPOINT = "https://serpapi.com/search.json";
const TIMEOUT_MS = 20_000;
export const AIRPORTS = /^[A-Z]{3}(,[A-Z]{3}){0,3}$/;

type Fetch = typeof fetch;
export interface LiveOptions { key: string; fetch?: Fetch }

export function serpApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SERPAPI_API_KEY?.trim() || undefined;
}

async function serp(params: Record<string, string | number | undefined>, { key, fetch: f = fetch }: LiveOptions) {
  const url = new URL(ENDPOINT);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  url.searchParams.set("api_key", key);
  // The URL carries the key, so errors name the status only, never the URL.
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok || typeof body.error === "string") {
    throw new Error(typeof body.error === "string" ? body.error : `SerpApi returned ${res.status}`);
  }
  return body;
}

const Stop = z.object({ id: z.string(), time: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/) });
const Segment = z.object({
  departure_airport: Stop,
  arrival_airport: Stop,
  airline: z.string(),
  flight_number: z.string().optional(),
  travel_class: z.string().optional(),
});
const Itinerary = z.object({
  flights: z.array(Segment).min(1),
  total_duration: z.number().int().positive(),
  price: z.number().positive(),
});

/** "2026-03-13 7:05" → "2026-03-13T07:05:00", the airport's local time. */
function isoLocal(time: string): string {
  const [date, clock] = time.split(" ") as [string, string];
  const [h, m] = clock.split(":") as [string, string];
  return `${date}T${h.padStart(2, "0")}:${m}:00`;
}

export interface FlightQuery { origin: string; destination: string; date: string; returnDate?: string }

/** Fares are searched for one adult, so each price is per person. */
export async function liveFlights(q: FlightQuery, opts: LiveOptions) {
  const body = await serp({
    engine: "google_flights", departure_id: q.origin, arrival_id: q.destination,
    outbound_date: q.date, return_date: q.returnDate, type: q.returnDate ? 1 : 2,
    adults: 1, currency: "USD", hl: "en", gl: "us",
  }, opts) as { best_flights?: unknown[]; other_flights?: unknown[] };
  const items = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
  return items.flatMap((item, i) => {
    const parsed = Itinerary.safeParse(item);
    if (!parsed.success) return [];
    const { flights, total_duration, price } = parsed.data;
    const first = flights[0]!;
    const last = flights[flights.length - 1]!;
    const airlines = [...new Set(flights.map((s) => s.airline))];
    const flightNumber = flights.map((s) => s.flight_number?.replace(/\s+/g, "") ?? s.airline).join(", ");
    return [{
      id: `gf-${q.date}-${i}-${flights.map((s) => s.flight_number ?? "").join("").replace(/\W/g, "").slice(0, 24)}`,
      carrier: airlines.join(" + "),
      flightNumber,
      origin: first.departure_airport.id,
      destination: last.arrival_airport.id,
      departLocal: isoLocal(first.departure_airport.time),
      arriveLocal: isoLocal(last.arrival_airport.time),
      durationMinutes: total_duration,
      stops: flights.length - 1,
      fare: { amount: Math.round(price), currency: "USD" as const },
      fareClass: first.travel_class ?? "Economy",
      holdAvailable: false,
    }];
  }).slice(0, 8);
}

const Property = z.object({
  type: z.string().optional(),
  name: z.string().min(1),
  property_token: z.string().optional(),
  rate_per_night: z.object({ extracted_lowest: z.number().positive() }),
  total_rate: z.object({ extracted_lowest: z.number().positive() }).optional(),
  extracted_hotel_class: z.number().optional(),
  hotel_class: z.string().optional(),
  overall_rating: z.number().min(0).max(5).optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.object({ thumbnail: z.string().url().optional() })).optional(),
});

export interface HotelQuery { destination: string; checkIn: string; checkOut: string; guests: number; maxNightlyUSD?: number }

export async function liveHotels(q: HotelQuery, nights: number, opts: LiveOptions) {
  const body = await serp({
    engine: "google_hotels", q: `hotels in ${q.destination}`, check_in_date: q.checkIn,
    check_out_date: q.checkOut, adults: q.guests, currency: "USD", hl: "en", gl: "us",
    max_price: q.maxNightlyUSD,
  }, opts) as { properties?: unknown[] };
  return (body.properties ?? []).flatMap((item, i) => {
    const parsed = Property.safeParse(item);
    if (!parsed.success || (parsed.data.type && parsed.data.type !== "hotel")) return [];
    const p = parsed.data;
    const nightly = Math.round(p.rate_per_night.extracted_lowest);
    if (q.maxNightlyUSD && nightly > q.maxNightlyUSD) return [];
    const stars = p.extracted_hotel_class ?? Number(p.hotel_class?.match(/^(\d)/)?.[1]);
    return [{
      id: `gh-${p.property_token?.replace(/\W/g, "").slice(0, 40) ?? i}`,
      name: p.name,
      ...(p.images?.[0]?.thumbnail ? { photoUrl: p.images[0].thumbnail } : {}),
      ...(stars >= 1 && stars <= 5 ? { starRating: stars } : {}),
      ...(p.overall_rating ? { reviewScore: p.overall_rating } : {}),
      pricePerNight: { amount: nightly, currency: "USD" as const },
      totalForStay: {
        amount: Math.round(p.total_rate?.extracted_lowest ?? nightly * nights),
        currency: "USD" as const,
      },
      amenities: (p.amenities ?? []).slice(0, 4),
    }];
  }).slice(0, 5);
}
