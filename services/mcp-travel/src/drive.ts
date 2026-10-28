import { parsePlace, pickByRegion } from "@concierge/mcp-kit";
import { USER_AGENT } from "./wikivoyage.js";

/**
 * Driving times from one origin to candidate destinations. Places are geocoded
 * with Open-Meteo (as mcp-weather does) and routed with OSRM over OpenStreetMap
 * roads. Both are free and keyless. Times are free-flow: no traffic or stops.
 */

const GEOCODER = "https://geocoding-api.open-meteo.com/v1/search";
// The public demo server allows light use (about 1 request/s); point OSRM_URL at a self-hosted router for more.
const OSRM = process.env.OSRM_URL ?? "https://router.project-osrm.org";
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: GeoHit | null }>();

type Fetch = typeof fetch;

interface GeoHit {
  label: string;
  latitude: number;
  longitude: number;
}

export interface Drive {
  destination: string;
  resolvedAs?: string;
  minutes?: number;
  miles?: number;
  label?: string;
  withinWindow?: boolean;
  error?: "place_not_found" | "no_road_route";
}

/** Common shorthand the geocoder does not know. */
const ALIASES: Record<string, string> = {
  nyc: "New York, NY",
  "new york city": "New York, NY",
  manhattan: "New York, NY",
  la: "Los Angeles, CA",
  sf: "San Francisco, CA",
  dc: "Washington, DC",
  "washington dc": "Washington, DC",
  "washington, d.c.": "Washington, DC",
  philly: "Philadelphia, PA",
};

export async function geocodePlace(place: string, fetchImpl: Fetch = fetch): Promise<GeoHit | null> {
  const key = place.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const parsed = parsePlace(ALIASES[key] ?? place);
  const url = new URL(GEOCODER);
  url.searchParams.set("name", parsed.name);
  url.searchParams.set("count", "10");
  url.searchParams.set("countryCode", parsed.country);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  const json = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string }[];
  };
  // "Lake George, NY" must not resolve to Lake George, MN; a territory already pins the country.
  const match = pickByRegion(json.results, parsed.country === "US" ? parsed.region : undefined);
  const region = parsed.country === "US" ? match?.admin1 : parsed.region;
  const value = match
    ? { label: region ? `${match.name}, ${region}` : match.name, latitude: match.latitude, longitude: match.longitude }
    : null;
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

const UNAVAILABLE_NOTE =
  "Routing is unavailable right now. Do not estimate drive times; say in notes that they could not be verified.";

export async function driveTimes(
  input: { origin: string; destinations: string[]; minHours?: number; maxHours?: number },
  fetchImpl: Fetch = fetch,
) {
  const { origin, minHours, maxHours } = input;
  const destinations = [...new Set(input.destinations.map((d) => d.trim()).filter(Boolean))];
  const window = minHours != null || maxHours != null ? { minHours, maxHours } : undefined;
  try {
    const [from, ...places] = await Promise.all(
      [origin, ...destinations].map((p) => geocodePlace(p, fetchImpl)),
    );
    if (!from) {
      return { origin, source: "unavailable", drives: [], note: `Could not find the origin "${origin}". Ask for the starting city with its state.` };
    }
    const routable = places.flatMap((p, i) => (p ? [{ i, p }] : []));
    let durations: (number | null)[] = [];
    let distances: (number | null)[] = [];
    if (routable.length) {
      const coords = [from, ...routable.map((r) => r.p)]
        .map((p) => `${p.longitude.toFixed(5)},${p.latitude.toFixed(5)}`)
        .join(";");
      const url = new URL(`${OSRM}/table/v1/driving/${coords}`);
      url.searchParams.set("sources", "0");
      url.searchParams.set("annotations", "duration,distance");
      const res = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`osrm ${res.status}`);
      const json = (await res.json()) as { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
      if (json.code !== "Ok" || !json.durations?.[0]) throw new Error(`osrm ${json.code}`);
      durations = json.durations[0];
      distances = json.distances?.[0] ?? [];
    }
    const drives: Drive[] = destinations.map((destination, i) => {
      const place = places[i];
      if (!place) return { destination, error: "place_not_found" };
      const column = routable.findIndex((r) => r.i === i) + 1;
      const seconds = durations[column];
      const meters = distances[column];
      if (seconds == null) return { destination, resolvedAs: place.label, error: "no_road_route" };
      const minutes = Math.round(seconds / 60);
      const hours = minutes / 60;
      return {
        destination,
        resolvedAs: place.label,
        minutes,
        miles: meters == null ? undefined : Math.round(meters / 1609.344),
        label: formatDuration(minutes),
        withinWindow: window
          ? (minHours == null || hours >= minHours) && (maxHours == null || hours <= maxHours)
          : undefined,
      };
    });
    return {
      origin: from.label,
      source: "osrm",
      data: "OpenStreetMap contributors (ODbL), routed by OSRM",
      trafficIncluded: false,
      window,
      drives,
      note: "Free-flow driving estimates from OpenStreetMap roads: no traffic, stops or holiday congestion. Say \"about <label> without traffic\". Check resolvedAs matches the intended place. place_not_found or no_road_route means the drive is unverified; never guess it.",
    };
  } catch {
    return { origin, source: "unavailable", drives: [], note: UNAVAILABLE_NOTE };
  }
}
