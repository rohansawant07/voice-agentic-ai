/** US place names: "Lake George, NY" → name + state, territories → ISO country. */

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Territories have their own ISO codes in geocoders, not "US". */
const TERRITORIES: Record<string, { name: string; country: string }> = {
  PR: { name: "Puerto Rico", country: "PR" },
  VI: { name: "U.S. Virgin Islands", country: "VI" },
  USVI: { name: "U.S. Virgin Islands", country: "VI" },
  GU: { name: "Guam", country: "GU" },
  AS: { name: "American Samoa", country: "AS" },
  MP: { name: "Northern Mariana Islands", country: "MP" },
};

const TERRITORY_NAMES: [RegExp, string][] = [
  [/puerto rico/i, "PR"],
  [/virgin islands|st\.? thomas|st\.? john|st\.? croix/i, "VI"],
  [/\bguam\b/i, "GU"],
  [/american samoa/i, "AS"],
  [/northern mariana/i, "MP"],
];

export interface Place {
  /** Locality without the region suffix, e.g. "Lake George". */
  name: string;
  /** Full state or territory name when given, e.g. "New York". */
  region?: string;
  /** ISO country code for geocoders: "US" or a territory code. */
  country: string;
}

export function parsePlace(input: string): Place {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(usa?|united states)$/i.test(p));
  const name = parts[0] ?? input.trim();
  let region: string | undefined;
  let country = "US";
  for (const part of parts.slice(1)) {
    const code = part.toUpperCase().replace(/\./g, "");
    if (STATES[code]) region = STATES[code];
    else if (TERRITORIES[code]) ({ name: region, country } = TERRITORIES[code]);
    else {
      const full = Object.values(STATES).find((s) => s.toLowerCase() === part.toLowerCase());
      if (full) region = full;
    }
  }
  for (const [pattern, code] of TERRITORY_NAMES)
    if (pattern.test(input)) ({ name: region, country } = TERRITORIES[code]!);
  return { name, region, country };
}

/** Prefer a result in the requested state; otherwise the geocoder's first. */
export function pickByRegion<T extends { admin1?: string }>(
  results: T[] | undefined,
  region: string | undefined,
): T | undefined {
  if (!results?.length) return undefined;
  if (!region) return results[0];
  return results.find((r) => r.admin1?.toLowerCase() === region.toLowerCase());
}
