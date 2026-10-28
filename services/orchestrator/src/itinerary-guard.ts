import type { ItineraryAgentOutput } from "@concierge/core";

/** One guide or activity listing as a tool returned it, tagged with its guide source. */
export interface EvidenceListing {
  title: string;
  /** "curated-official-guide", "wikivoyage", or "inventory" for the demo activity catalog. */
  source: string;
  kind?: string;
  description?: string;
  address?: string;
  hours?: string;
  listedPrice?: string;
  dietaryOptions?: string[];
  seasonUnconfirmed?: boolean;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Picks the known listing fields out of an untrusted tool payload entry. */
export function listingFrom(raw: Record<string, unknown>, source: string): EvidenceListing {
  const dietary = raw.dietaryOptions ?? raw.dietary;
  return {
    title: String(raw.title),
    source,
    kind: text(raw.kind),
    description: text(raw.description),
    address: text(raw.address),
    hours: text(raw.hours),
    listedPrice: text(raw.listedPrice),
    dietaryOptions: Array.isArray(dietary) ? dietary.filter((d): d is string => typeof d === "string") : undefined,
    seasonUnconfirmed: raw.seasonUnconfirmed === true || undefined,
  };
}

/** What the itinerary specialist's tools returned, collected while it ran. */
export interface ItineraryEvidence {
  /** Listings from get_destination_guide / search_activities results. */
  listings: EvidenceListing[];
  /** Listings removed as closed on the trip dates (closedDuringTrip). */
  closed: string[];
  /** search_web returned cited evidence, which the prompt allows for extra stops. */
  webEvidence: boolean;
  /** Trip range as YYYY-MM-DD, from the delegation context or forecast arguments. */
  start?: string;
  end?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const normalize = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");

/**
 * The listing a stop refers to: an exact title (ignoring case and punctuation),
 * or the single listing whose whole title appears inside the stop title
 * ("La Bombonera dinner"). Merged stops that name two listings match none.
 */
export function matchListing(title: string, listings: string[]): string | undefined {
  const t = normalize(title);
  const exact = listings.find((l) => normalize(l) === t);
  if (exact) return exact;
  const contained = [...new Set(listings)].filter((l) => {
    const n = normalize(l);
    return n.length >= 4 && ` ${t} `.includes(` ${n} `);
  });
  return contained.length === 1 ? contained[0] : undefined;
}

/** Trip dates from common context keys; the orchestrator passes free-form context. */
export function tripRange(context: Record<string, unknown> | undefined): { start?: string; end?: string } {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = context?.[k];
      if (typeof v === "string" && ISO_DATE.test(v)) return v;
    }
    return undefined;
  };
  return { start: pick("startDate", "checkIn", "departDate"), end: pick("endDate", "checkOut", "returnDate") };
}

const KIND_LABELS: Record<string, string> = {
  culture: "Cultural visit",
  outdoors: "Outdoor activity",
  beach: "Beach time",
  family: "Family activity",
  food: "Food stop",
  sight: "Sight",
  activity: "Activity",
};
const SOURCE_LABELS: Record<string, string> = {
  "curated-official-guide": "the National Park Service planning guide",
  wikivoyage: "Wikivoyage",
  inventory: "Roam's demo activity list",
};

/**
 * A description built only from a listing's own fields, for listings with no
 * guide text, so title-only entries never pick up model-supplied detail.
 */
export function describeListing(l: EvidenceListing): string {
  const parts = [`${KIND_LABELS[l.kind ?? ""] ?? "Stop"} from ${SOURCE_LABELS[l.source] ?? "the trip guide"}.`];
  if (l.address) parts.push(`Address: ${l.address}.`);
  if (l.hours) parts.push(`Listed hours: ${l.hours}.`);
  if (l.listedPrice) parts.push(`Listed price: ${l.listedPrice}.`);
  if (l.dietaryOptions?.length) parts.push(`Dietary options: ${l.dietaryOptions.join(", ")}.`);
  if (l.source === "curated-official-guide") parts.push("Confirm current access and hours with NPS.");
  else if (l.source === "inventory") parts.push("Demo listing, not verified.");
  if (l.seasonUnconfirmed) parts.push("Confirm it's open on your dates.");
  return parts.join(" ");
}

const dayCount = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Which compared destination a day belongs to. The prompt names the destination
 * in each comparison dayLabel ("Lenox, MA · Day 1 · Thu Nov 26"): match a suggested
 * destination's place name, else use the label text before "Day N". Plain
 * "Day 1 · …" labels share one key, so a single-destination trip keeps one plan.
 */
export function destinationKey(dayLabel: string, destinations: { destination: string }[] = []): string {
  const label = ` ${normalize(dayLabel)} `;
  const places = destinations
    .map((d) => normalize(d.destination.split(/[,(]/)[0] ?? ""))
    .filter((p) => p.length >= 3 && label.includes(` ${p} `));
  const place = places.sort((a, b) => b.length - a.length)[0];
  if (place) return place;
  return normalize(dayLabel.split(/\bday\s*\d/i)[0] ?? "");
}

/**
 * Enforces in code what the prompt asks for: stops use exact listing titles,
 * closed or unlisted places are removed, and days stay inside the trip dates.
 * Returns the corrected data plus a plain note describing what was removed.
 */
export function guardItinerary(data: ItineraryAgentOutput, evidence: ItineraryEvidence): ItineraryAgentOutput {
  if (!data.days?.length) return data;
  const removed: string[] = [];
  const closed = new Set(evidence.closed.map(normalize));
  const titles = evidence.listings.map((l) => l.title);
  // The same place can come back from both tools; prefer the record with guide text.
  const byTitle = new Map<string, EvidenceListing>();
  for (const l of evidence.listings) {
    const seen = byTitle.get(l.title);
    if (!seen || (!seen.description && l.description)) byTitle.set(l.title, l);
  }
  let days = data.days;

  if (titles.length) {
    days = days.map((day) => {
      const stops = day.stops.flatMap((stop) => {
        const title = matchListing(stop.title, titles);
        if (title && !closed.has(normalize(title))) {
          const listing = byTitle.get(title)!;
          // Model wording is kept only where the listing has its own description.
          return [{ ...stop, title, description: listing.description ? stop.description : describeListing(listing) }];
        }
        // Web-backed extra stops are allowed by the prompt; closed places never are.
        if (!title && evidence.webEvidence && !closed.has(normalize(stop.title))) return [stop];
        removed.push(stop.title);
        return [];
      });
      const meal = day.mealPick && normalize(day.mealPick);
      const mealListed = meal && titles.some((l) => ` ${meal} `.includes(` ${normalize(l)} `));
      return { ...day, stops, ...(day.mealPick && !mealListed ? { mealPick: undefined } : {}) };
    });
  }
  const emptyDays = days.filter((d) => d.stops.length === 0).length;
  days = days.filter((d) => d.stops.length > 0);

  let outOfRange = 0;
  if (evidence.start) {
    // Each compared destination gets its own plan for the trip dates.
    const limit = evidence.end ? dayCount(evidence.start, evidence.end) : Infinity;
    const seen = new Map<string, Set<string>>();
    const kept = days.filter((d) => {
      if (!ISO_DATE.test(d.date)) return true;
      const inside = d.date >= evidence.start! && (!evidence.end || d.date <= evidence.end);
      const key = destinationKey(d.dayLabel, data.destinations);
      const dates = seen.get(key) ?? new Set<string>();
      if (!inside || dates.has(d.date) || dates.size >= limit) return false;
      seen.set(key, dates.add(d.date));
      return true;
    });
    outOfRange = days.length - kept.length;
    days = kept;
  }

  const notes = [
    removed.length && `Removed ${removed.length} stop(s) that did not match a guide listing: ${removed.join("; ")}.`,
    emptyDays && `Removed ${emptyDays} day(s) left without sourced stops.`,
    outOfRange && `Removed ${outOfRange} day(s) outside the trip dates.`,
  ].filter(Boolean);
  if (!notes.length) return { ...data, days };
  return { ...data, days, notes: [data.notes, ...notes].filter(Boolean).join(" ") };
}

/** An "ok" itinerary result must carry day plans or destination suggestions. */
export const hasItineraryContent = (data: ItineraryAgentOutput | null | undefined) =>
  Boolean(data?.days?.length || data?.destinations?.length);
