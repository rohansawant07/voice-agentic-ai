import type { FlightSearch, HotelSearch } from "@concierge/core";

/**
 * Booking-site search links built from validated search fields. The models
 * copy the fields; only this file turns them into URLs. Links open a search
 * on the site: Roam has not checked the prices or seats shown there.
 */

export interface BookingLink {
  site: string;
  url: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AIRPORTS = /^[A-Z]{3}(,[A-Z]{3}){0,3}$/;

const validDate = (value: string | undefined): value is string =>
  !!value && DATE.test(value) && !Number.isNaN(Date.parse(value));

export function flightLinks(search: FlightSearch): BookingLink[] {
  const { origin, destination, departDate, returnDate } = search;
  if (!AIRPORTS.test(origin) || !AIRPORTS.test(destination) || !validDate(departDate)) return [];
  const back = validDate(returnDate) && returnDate > departDate ? returnDate : undefined;
  const adults = Math.min(Math.max(Math.trunc(search.passengers) || 1, 1), 9);
  // Skyscanner and Booking.com take one airport per end; use the first listed.
  const from = origin.split(",")[0]!;
  const to = destination.split(",")[0]!;
  const yymmdd = (date: string) => date.slice(2).replaceAll("-", "");

  const skyscanner = new URL(
    `https://www.skyscanner.com/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${yymmdd(departDate)}/${back ? `${yymmdd(back)}/` : ""}`,
  );
  skyscanner.searchParams.set("adultsv2", String(adults));
  skyscanner.searchParams.set("cabinclass", "economy");

  const google = new URL("https://www.google.com/travel/flights");
  google.searchParams.set(
    "q",
    `Flights to ${to} from ${from} on ${departDate}${back ? ` through ${back}` : ""} for ${adults} adult${adults > 1 ? "s" : ""}`,
  );

  const booking = new URL(`https://flights.booking.com/flights/${from}.AIRPORT-${to}.AIRPORT/`);
  for (const [name, value] of Object.entries({
    type: back ? "ROUNDTRIP" : "ONEWAY",
    adults: String(adults),
    cabinClass: "ECONOMY",
    from: `${from}.AIRPORT`,
    to: `${to}.AIRPORT`,
    depart: departDate,
    return: back,
  })) if (value) booking.searchParams.set(name, value);

  return [
    { site: "Skyscanner", url: skyscanner.toString() },
    { site: "Google Flights", url: google.toString() },
    { site: "Booking.com", url: booking.toString() },
  ];
}

// Booking.com reads "San Juan, PR" as San Juan in Spain and "Portland, ME" as
// a hotel name, but finds "San Juan, Puerto Rico" and "Portland, Maine".
const US_PLACES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
  VI: "U.S. Virgin Islands", GU: "Guam", AS: "American Samoa", MP: "Northern Mariana Islands",
};

/** "Portland, ME" → "Portland, Maine"; anything else is left as written. */
export function spellOutPlace(destination: string): string {
  return destination.replace(/,\s*([A-Za-z]{2})\s*$/, (match, code: string) => {
    const name = US_PLACES[code.toUpperCase()];
    return name ? `, ${name}` : match;
  });
}

export function hotelLinks(search: HotelSearch): BookingLink[] {
  const destination = spellOutPlace(search.destination.trim().slice(0, 120));
  const { checkIn, checkOut } = search;
  if (destination.length < 2 || !validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn) return [];
  const adults = Math.min(Math.max(Math.trunc(search.guests) || 1, 1), 8);

  const booking = new URL("https://www.booking.com/searchresults.html");
  for (const [name, value] of Object.entries({
    ss: destination,
    checkin: checkIn,
    checkout: checkOut,
    group_adults: String(adults),
    no_rooms: "1",
    group_children: "0",
  })) booking.searchParams.set(name, value);

  const google = new URL("https://www.google.com/travel/search");
  google.searchParams.set("q", `Hotels in ${destination} from ${checkIn} to ${checkOut} for ${adults} adult${adults > 1 ? "s" : ""}`);

  return [
    { site: "Booking.com", url: booking.toString() },
    { site: "Google Hotels", url: google.toString() },
  ];
}
