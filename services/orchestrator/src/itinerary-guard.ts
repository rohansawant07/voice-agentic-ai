import type { ItineraryAgentOutput } from "@concierge/core";

/** What the itinerary specialist's tools returned, collected while it ran. */
export interface ItineraryEvidence {
  /** Titles from get_destination_guide / search_activities results. */
  listings: string[];
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

const dayCount = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Enforces in code what the prompt asks for: stops use exact listing titles,
 * closed or unlisted places are removed, and days stay inside the trip dates.
 * Returns the corrected data plus a plain note describing what was removed.
 */
export function guardItinerary(data: ItineraryAgentOutput, evidence: ItineraryEvidence): ItineraryAgentOutput {
  if (!data.days?.length) return data;
  const removed: string[] = [];
  const closed = new Set(evidence.closed.map(normalize));
  let days = data.days;

  if (evidence.listings.length) {
    days = days.map((day) => {
      const stops = day.stops.flatMap((stop) => {
        const listing = matchListing(stop.title, evidence.listings);
        if (listing && !closed.has(normalize(listing))) return [{ ...stop, title: listing }];
        // Web-backed extra stops are allowed by the prompt; closed places never are.
        if (!listing && evidence.webEvidence && !closed.has(normalize(stop.title))) return [stop];
        removed.push(stop.title);
        return [];
      });
      const meal = day.mealPick && normalize(day.mealPick);
      const mealListed = meal && evidence.listings.some((l) => ` ${meal} `.includes(` ${normalize(l)} `));
      return { ...day, stops, ...(day.mealPick && !mealListed ? { mealPick: undefined } : {}) };
    });
  }
  const emptyDays = days.filter((d) => d.stops.length === 0).length;
  days = days.filter((d) => d.stops.length > 0);

  let outOfRange = 0;
  if (evidence.start) {
    const seen = new Set<string>();
    const kept = days.filter((d) => {
      if (!ISO_DATE.test(d.date)) return true;
      const inside = d.date >= evidence.start! && (!evidence.end || d.date <= evidence.end);
      if (!inside || seen.has(d.date)) return false;
      seen.add(d.date);
      return true;
    });
    const limit = evidence.end ? dayCount(evidence.start, evidence.end) : kept.length;
    outOfRange = days.length - Math.min(kept.length, limit);
    days = kept.slice(0, limit);
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
