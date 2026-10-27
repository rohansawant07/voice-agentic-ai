import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parsePlace, pickByRegion, serveMcp, toolResult } from "@concierge/mcp-kit";

const PORT = Number(process.env.PORT ?? 8102);
const MOCK = process.env.WEATHER_PROVIDER === "mock"; // deterministic mode for evals/CI

const WMO: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain",
  65: "heavy rain", 66: "freezing rain", 67: "freezing rain", 71: "light snow",
  73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers",
  81: "rain showers", 82: "heavy showers", 85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail",
};

async function geocode(place: string) {
  // NPS River Access coordinates; avoid similarly named or unrelated geocoder hits.
  // https://www.nps.gov/hafe/planyourvisit/gettingaround.htm
  if (/harper.?s ferry/i.test(place)) return {
    name: "Harpers Ferry", admin1: "West Virginia",
    latitude: 39.3216956806, longitude: -77.7432835354,
  };
  // "Lake George, NY" must not resolve to Lake George, MN; San Juan lives under PR.
  const parsed = /shenandoah valley|shenandoah national park/i.test(place)
    ? { name: "Luray", region: "Virginia", country: "US" }
    : parsePlace(place);
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", parsed.name);
  url.searchParams.set("count", "10");
  url.searchParams.set("countryCode", parsed.country);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const json = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string }[];
  };
  // A territory name already pins the country; a state must match admin1.
  const hit = pickByRegion(json.results, parsed.country === "US" ? parsed.region : undefined);
  return hit && parsed.country !== "US" ? { ...hit, admin1: parsed.region } : hit;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** Average daily high/low for a month over the last three completed years. */
async function historicalClimate(place: string, month: number) {
  const loc = await geocode(place);
  if (!loc) return undefined;
  const now = new Date();
  const lastYear = now.getUTCMonth() + 1 > month ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const years = [lastYear - 2, lastYear - 1, lastYear];
  const highs: number[] = [];
  const lows: number[] = [];
  await Promise.all(years.map(async (year) => {
    const mm = String(month).padStart(2, "0");
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude", String(loc.latitude));
    url.searchParams.set("longitude", String(loc.longitude));
    url.searchParams.set("start_date", `${year}-${mm}-01`);
    url.searchParams.set("end_date", `${year}-${mm}-${last}`);
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("timezone", "auto");
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const json = (await res.json()) as {
      daily?: { temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] };
    };
    for (const v of json.daily?.temperature_2m_max ?? []) if (v != null) highs.push(v);
    for (const v of json.daily?.temperature_2m_min ?? []) if (v != null) lows.push(v);
  }));
  if (!highs.length || !lows.length) return undefined;
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    place: `${loc.name}${loc.admin1 ? ", " + loc.admin1 : ""}`,
    month,
    avgHighF: avg(highs),
    avgLowF: avg(lows),
    source: "open-meteo-archive",
    note: `Average of observed daily highs and lows for ${MONTHS[month - 1]} ${years[0]}–${years[2]}. Typical conditions, not a forecast.`,
  };
}

/** Typical-climate table for demo destinations — used by get_climate_summary
 *  and as the deterministic mock forecast (WEATHER_PROVIDER=mock). */
const CLIMATE: Record<string, { hi: number[]; lo: number[]; note: string }> = {
  // monthly avg °F, index 0 = Jan
  "san juan":  { hi: [83,83,84,85,87,88,88,89,89,88,86,84], lo: [72,72,73,74,76,77,77,77,76,76,74,73], note: "warm year-round; brief showers" },
  "miami":     { hi: [76,78,80,83,87,89,91,91,89,86,81,78], lo: [61,63,66,69,74,76,77,77,76,73,68,64], note: "humid summers, mild winters" },
  "honolulu":  { hi: [80,80,81,83,85,87,88,89,89,87,84,81], lo: [66,66,68,69,71,73,74,75,74,73,71,68], note: "trade winds keep it pleasant" },
  "orlando":   { hi: [71,74,78,83,88,91,92,92,90,85,78,73], lo: [49,52,56,61,67,72,74,74,72,66,58,52], note: "afternoon storms in summer" },
  "denver":    { hi: [45,46,54,61,70,82,89,86,79,66,53,44], lo: [18,19,26,34,44,53,59,57,48,36,25,17], note: "big day-night swings; dry" },
  "sedona":    { hi: [57,61,66,73,82,92,97,94,89,78,66,56], lo: [31,34,38,44,52,60,67,65,59,48,37,30], note: "desert highs, cool nights" },
  "asheville": { hi: [47,51,59,68,75,81,84,83,77,68,58,49], lo: [28,30,36,43,52,60,64,63,56,45,36,30], note: "mountain weather shifts fast" },
  "st. thomas":{ hi: [84,84,85,86,87,88,89,90,90,89,87,85], lo: [73,73,74,75,77,78,78,78,77,77,76,74], note: "steady Caribbean warmth" },
};

function climateFor(place: string) {
  const key = Object.keys(CLIMATE).find((k) => place.toLowerCase().includes(k));
  return key ? { key, ...CLIMATE[key]! } : undefined;
}

function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-weather", version: "0.1.0" });

  server.registerTool(
    "get_forecast",
    {
      description:
        "Daily weather forecast (°F) for a US place over a date range (up to 16 days out). Use before recommending outdoor/beach days.",
      inputSchema: {
        place: z.string().describe('e.g. "San Juan, Puerto Rico"'),
        startDate: z.string().describe("YYYY-MM-DD"),
        endDate: z.string().describe("YYYY-MM-DD"),
      },
    },
    async ({ place, startDate, endDate }) => {
      if (MOCK) {
        const c = climateFor(place);
        const month = new Date(startDate).getMonth();
        const days: { date: string; summary: string; highF: number; lowF: number }[] = [];
        for (let t = Date.parse(startDate); t <= Date.parse(endDate); t += 86_400_000) {
          days.push({
            date: new Date(t).toISOString().slice(0, 10),
            summary: c ? "partly cloudy" : "clear",
            highF: c?.hi[month] ?? 75,
            lowF: c?.lo[month] ?? 60,
          });
        }
        return toolResult({ place, source: "mock-climate", days });
      }
      const loc = await geocode(place);
      if (!loc) return toolResult({ error: "place_not_found", place });
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(loc.latitude));
      url.searchParams.set("longitude", String(loc.longitude));
      url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
      url.searchParams.set("temperature_unit", "fahrenheit");
      url.searchParams.set("start_date", startDate);
      url.searchParams.set("end_date", endDate);
      url.searchParams.set("timezone", "auto");
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return toolResult({ error: "forecast_unavailable", detail: res.status });
      const json = (await res.json()) as {
        daily?: {
          time: string[];
          weather_code: number[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
          precipitation_probability_max: (number | null)[];
        };
      };
      const d = json.daily;
      if (!d) return toolResult({ error: "forecast_unavailable" });
      const days = d.time.map((date, i) => ({
        date,
        summary: WMO[d.weather_code[i] ?? 0] ?? "unknown",
        highF: Math.round(d.temperature_2m_max[i] ?? 0),
        lowF: Math.round(d.temperature_2m_min[i] ?? 0),
        precipChancePct: d.precipitation_probability_max[i] ?? null,
      }));
      return toolResult({ place: `${loc.name}${loc.admin1 ? ", " + loc.admin1 : ""}`, source: "open-meteo", days });
    },
  );

  server.registerTool(
    "get_climate_summary",
    {
      description:
        "Typical climate for any US place in a given month (avg high/low °F), from a curated table or the last three years of observed weather. Use for trips beyond the 16-day forecast window or 'somewhere warm in February' questions. Include the state, e.g. \"Lake George, NY\".",
      inputSchema: {
        place: z.string(),
        month: z.number().int().min(1).max(12),
      },
    },
    async ({ place, month }) => {
      const c = climateFor(place);
      if (!c) {
        if (MOCK) return toolResult({ error: "no_climate_data", place });
        const observed = await historicalClimate(place, month).catch(() => undefined);
        return toolResult(observed ?? { error: "no_climate_data", place });
      }
      return toolResult({
        place,
        month,
        avgHighF: c.hi[month - 1],
        avgLowF: c.lo[month - 1],
        note: c.note,
      });
    },
  );

  return server;
}

serveMcp({ name: "mcp-weather", port: PORT, createServer });
