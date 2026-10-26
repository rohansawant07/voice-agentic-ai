import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
export const AirbnbInput = z.object({
  destination: z.string().trim().min(2).max(200),
  checkIn: date,
  checkOut: date,
  adults: z.number().int().min(1).max(16).default(2),
  children: z.number().int().min(0).max(10).default(0),
  pets: z.number().int().min(0).max(5).default(0),
  maxNightlyUSD: z.number().positive().optional(),
}).refine((value) => value.checkOut > value.checkIn, "Check-out must follow check-in");
export type AirbnbQuery = z.input<typeof AirbnbInput>;

export function airbnbSearchUrl(input: AirbnbQuery): string {
  const q = AirbnbInput.parse(input);
  const url = new URL(`https://www.airbnb.com/s/${encodeURIComponent(q.destination)}/homes`);
  for (const [key, value] of Object.entries({
    checkin: q.checkIn, checkout: q.checkOut, adults: q.adults,
    children: q.children, pets: q.pets, currency: "USD", price_max: q.maxNightlyUSD,
  })) if (value !== undefined) url.searchParams.set(key, String(value));
  return url.toString();
}

/** The independent connector respects robots.txt. No override is exposed to models. */
async function callAirbnb(args: Record<string, unknown>): Promise<unknown> {
  const require = createRequire(import.meta.url);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [require.resolve("@openbnb/mcp-server-airbnb/dist/index.js")],
    stderr: "ignore",
    // Do not pass provider secrets or inherited robots overrides to the child.
    env: { PATH: process.env.PATH ?? "", DISABLE_GEOCODING: "true" },
  });
  const client = new Client({ name: "concierge-airbnb", version: "1.0.0" });
  const timer = setTimeout(() => { void transport.close(); }, 20_000);
  try {
    await client.connect(transport);
    return await client.callTool({ name: "airbnb_search", arguments: args }, undefined, { timeout: 15_000 });
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

const ProviderResponse = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});
const Listing = z.object({
  id: z.string().regex(/^\d+$/),
  demandStayListing: z.object({ description: z.string().optional() }).optional(),
  structuredDisplayPrice: z.object({
    primaryLine: z.object({ accessibilityLabel: z.string().optional() }).optional(),
    secondaryLine: z.object({ accessibilityLabel: z.string().optional() }).optional(),
  }).optional(),
});
let activeSearches = 0;

export async function searchAirbnb(input: AirbnbQuery, call = callAirbnb) {
  const q = AirbnbInput.parse(input);
  const searchUrl = airbnbSearchUrl(q);
  const base = { provider: "Airbnb", destination: q.destination, searchUrl,
    availabilityVerified: false, source: "independent-public-page-connector" };
  const fallback = (reason: string) => ({ ...base, status: "search_link_only", listings: [],
    note: `${reason} Open the Airbnb search link to check actual listings, dates, fees, and availability. Do not invent prices or properties.` });
  if ((process.env.AIRBNB_SEARCH_MODE ?? "links") !== "live") return fallback("Direct search links are enabled.");
  if (activeSearches >= 2) return fallback("Live search is busy.");
  activeSearches++;
  try {
    const response = ProviderResponse.parse(await call({
      location: q.destination, checkin: q.checkIn, checkout: q.checkOut,
      adults: q.adults, children: q.children, pets: q.pets,
      ...(q.maxNightlyUSD ? { maxPrice: q.maxNightlyUSD } : {}),
      ignoreRobotsText: false,
    }));
    if (response.isError) return fallback("Live Airbnb search is unavailable or restricted.");
    const text = response.content.find((item) => item.type === "text")?.text;
    const data = z.object({ searchResults: z.array(z.unknown()) }).parse(JSON.parse(text ?? "{}"));
    const listings = data.searchResults.flatMap((item) => {
      const parsed = Listing.safeParse(item);
      if (!parsed.success) return [];
      const listing = parsed.data;
      const url = new URL(`https://www.airbnb.com/rooms/${listing.id}`);
      url.search = new URL(searchUrl).search;
      return [{ id: listing.id, name: listing.demandStayListing?.description ?? "Airbnb vacation rental",
        url: url.toString(),
        priceText: listing.structuredDisplayPrice?.primaryLine?.accessibilityLabel,
        priceDetail: listing.structuredDisplayPrice?.secondaryLine?.accessibilityLabel }];
    }).slice(0, 5);
    if (!listings.length) return fallback("No readable live listings were returned; this does not prove there are no stays.");
    return { ...base, status: "live_results", listings,
      note: "Public-page results, not a reservation or a final quote. Verify location, availability, currency, taxes and fees on Airbnb. Price labels are shown exactly as returned." };
  } catch {
    return fallback("Live Airbnb search could not complete.");
  } finally {
    activeSearches--;
  }
}
