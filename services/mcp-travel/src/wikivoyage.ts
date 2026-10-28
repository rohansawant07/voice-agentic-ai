import { parsePlace } from "@concierge/mcp-kit";

/**
 * Community travel-guide listings from Wikivoyage for destinations without a
 * curated guide. Listings are sourced, dated and attributable, but not verified
 * by Roam: hours, prices and seasonal openings must be confirmed by travelers.
 */

const API = "https://en.wikivoyage.org/w/api.php";
export const USER_AGENT =
  "RoamTravelPrototype/0.1 (https://github.com/rohansawant07/voice-agentic-ai)";
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: WikivoyageGuide | null }>();

export interface GuideListing {
  title: string;
  kind: "sight" | "activity" | "food";
  description?: string;
  address?: string;
  hours?: string;
  listedPrice?: string;
  website?: string;
  lastEdited?: string;
}

export interface WikivoyageGuide {
  destination: string;
  guideTitle: string;
  source: "wikivoyage";
  sourceUrl: string;
  license: string;
  weatherPlace: string;
  pricesVerified: false;
  note: string;
  activities: GuideListing[];
}

type Fetch = typeof fetch;

const KINDS: Record<string, GuideListing["kind"]> = {
  see: "sight",
  do: "activity",
  eat: "food",
  drink: "food",
};

async function api(params: Record<string, string>, fetchImpl: Fetch) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ ...params, format: "json", formatversion: "2" }))
    url.searchParams.set(k, v);
  const res = await fetchImpl(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`wikivoyage ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const baseTitle = (title: string) => title.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
const qualifier = (title: string) => title.match(/\(([^)]+)\)\s*$/)?.[1]?.toLowerCase();

/** Exact locality match; a "(State)" qualifier must agree with the request. */
export function chooseTitle(titles: string[], destination: string): string | undefined {
  const place = parsePlace(destination);
  const wanted = place.name.toLowerCase();
  const region = place.region?.toLowerCase();
  const exact = titles.filter((t) => baseTitle(t) === wanted);
  return (
    exact.find((t) => region && qualifier(t) === region) ??
    exact.find((t) => !qualifier(t) || !region || qualifier(t) === region)
  );
}

/** Splits template parameters on top-level pipes (ignores [[a|b]] and {{x|y}}). */
function splitParams(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") { depth++; current += two; i++; continue; }
    if ((two === "}}" || two === "]]") && depth > 0) { depth--; current += two; i++; continue; }
    if (body[i] === "|" && depth === 0) { parts.push(current); current = ""; continue; }
    current += body[i];
  }
  parts.push(current);
  return parts;
}

export function cleanWikitext(text: string): string {
  let out = text;
  for (let i = 0; i < 3; i++) out = out.replace(/\{\{[^{}]*\}\}/g, "");
  return out
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/\S+\]/g, "")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/** Extracts {{see|...}}, {{do|...}}, {{eat|...}}, {{drink|...}} listings. */
export function parseListings(wikitext: string): (GuideListing & { lat?: number; long?: number })[] {
  const listings: (GuideListing & { lat?: number; long?: number })[] = [];
  const start = /\{\{\s*(see|do|eat|drink)\s*(?=\||\n)/gi;
  let match: RegExpExecArray | null;
  while ((match = start.exec(wikitext))) {
    let depth = 0;
    let end = -1;
    for (let i = match.index; i < wikitext.length - 1; i++) {
      const two = wikitext.slice(i, i + 2);
      if (two === "{{") { depth++; i++; } else if (two === "}}") { depth--; i++; if (depth === 0) { end = i - 1; break; } }
    }
    if (end < 0) break;
    const body = wikitext.slice(match.index + 2, end);
    start.lastIndex = end;
    const fields: Record<string, string> = {};
    for (const param of splitParams(body).slice(1)) {
      const eq = param.indexOf("=");
      if (eq > 0) fields[param.slice(0, eq).trim().toLowerCase()] = param.slice(eq + 1).trim();
    }
    const title = cleanWikitext(fields.name ?? "");
    if (!title) continue;
    const text = (key: string, max = 140) => {
      const value = cleanWikitext(fields[key] ?? "");
      return value ? value.slice(0, max) : undefined;
    };
    const description = text("content", 260);
    const website = /^https:\/\//.test(fields.url ?? "") ? fields.url : undefined;
    listings.push({
      title,
      kind: KINDS[match[1]!.toLowerCase()]!,
      description: description && description.length === 260 ? `${description}…` : description,
      address: text("address"),
      hours: text("hours"),
      listedPrice: text("price"),
      website,
      lastEdited: /^\d{4}-\d{2}-\d{2}$/.test(fields.lastedit ?? "") ? fields.lastedit : undefined,
      lat: Number(fields.lat) || undefined,
      long: Number(fields.long) || undefined,
    });
  }
  return listings;
}

const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const inRange = (month: number, from: number, to: number) =>
  from <= to ? month >= from && month <= to : month >= from || month <= to;

/**
 * Whether a listing's own text says it is open in a month (1-12):
 * "closed Nov-Apr" → false in November; "May-Oct" / "Open April-October" → false in November.
 * Undefined when the listing states no season.
 */
export function openInMonth(listing: Pick<GuideListing, "hours" | "description">, month: number): boolean | undefined {
  const text = `${listing.hours ?? ""} ${listing.description ?? ""}`;
  const range = `${MONTH}\\s*(?:-|–|to|through)\\s*${MONTH}`;
  const closed = text.match(new RegExp(`closed\\s+(?:from\\s+)?${range}`, "i"));
  if (closed) return !inRange(month, monthIndex(closed[1]!), monthIndex(closed[2]!));
  const open = text.match(new RegExp(`(?:open\\s+(?:from\\s+)?|^\\s*)?\\b${range}\\b`, "i"));
  if (open) return inRange(month, monthIndex(open[1]!), monthIndex(open[2]!));
  return undefined;
}

/**
 * Removes listings that say they are closed in the trip month and flags the
 * rest whose season is unknown, so closures never depend on model judgment.
 */
export function forTripMonth(guide: WikivoyageGuide, month: number | undefined) {
  if (!month) return guide;
  const closed: string[] = [];
  const activities: (GuideListing & { seasonUnconfirmed?: true })[] = [];
  for (const listing of guide.activities) {
    const open = openInMonth(listing, month);
    if (open === false) closed.push(listing.title);
    else activities.push(open ? listing : { ...listing, seasonUnconfirmed: true });
  }
  return {
    ...guide,
    activities,
    closedDuringTrip: closed,
    note: `${guide.note} Listings closed in the trip month were removed (see closedDuringTrip). seasonUnconfirmed means the listing states no season: describe it only with its own words and tell the traveler to confirm it is open on their dates.`,
  };
}

/** US states and territories, including Guam and the Northern Marianas. */
export function inUS(lat: number, long: number): boolean {
  const americas = lat > 13 && lat < 72 && long > -180 && long < -64;
  const pacific = lat > 13 && lat < 21 && long > 144 && long < 147;
  const samoa = lat > -15 && lat < -11 && long > -171 && long < -168;
  return americas || pacific || samoa;
}

export async function wikivoyageGuide(
  destination: string,
  fetchImpl: Fetch = fetch,
): Promise<WikivoyageGuide | null> {
  const key = destination.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const place = parsePlace(destination);
  // "Paris" alone ranks the French page first; the state surfaces "Paris (Texas)".
  const queries = place.region ? [`${place.name} ${place.region}`, place.name] : [place.name];
  const titles: string[] = [];
  for (const srsearch of queries) {
    const search = (await api(
      { action: "query", list: "search", srsearch, srlimit: "10", srnamespace: "0" },
      fetchImpl,
    )) as { query?: { search?: { title: string }[] } };
    titles.push(...(search.query?.search ?? []).map((r) => r.title));
  }
  const title = chooseTitle([...new Set(titles)], destination);
  let value: WikivoyageGuide | null = null;
  if (title) {
    const page = (await api(
      { action: "parse", page: title, prop: "wikitext", redirects: "1" },
      fetchImpl,
    )) as { parse?: { title: string; wikitext: string } };
    const wikitext = page.parse?.wikitext ?? "";
    const listings = parseListings(wikitext);
    const geo = wikitext.match(/\{\{\s*geo\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)/i);
    const coords = geo
      ? { lat: Number(geo[1]), long: Number(geo[2]) }
      : listings.find((l) => l.lat && l.long);
    const disambiguation = /\{\{\s*disamb/i.test(wikitext);
    // Same-named towns: a requested state must appear in the title or the page.
    const region = place.region?.toLowerCase();
    const sameRegion = !region || qualifier(title) === region || wikitext.toLowerCase().includes(region);
    const usable = listings.filter((l) => l.description || l.address);
    if (!disambiguation && sameRegion && coords?.lat && coords.long && inUS(coords.lat, coords.long) && usable.length >= 3) {
      const resolved = page.parse!.title;
      const sights = usable.filter((l) => l.kind !== "food").slice(0, 10);
      const food = usable.filter((l) => l.kind === "food").slice(0, 6);
      value = {
        destination,
        guideTitle: resolved,
        source: "wikivoyage",
        sourceUrl: `https://en.wikivoyage.org/wiki/${encodeURIComponent(resolved.replace(/ /g, "_"))}`,
        license: "Wikivoyage contributors, CC BY-SA 4.0",
        weatherPlace: place.region ? `${place.name}, ${place.region}` : place.name,
        pricesVerified: false,
        note: "Community-edited Wikivoyage listings, not verified by Roam. Hours, prices and seasonal openings change; many attractions close off-season. Confirm before going. Use only these listings; do not add places.",
        activities: [...sights, ...food].map(({ lat: _lat, long: _long, ...listing }) => listing),
      };
    }
  }
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}
