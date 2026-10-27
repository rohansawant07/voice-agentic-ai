import type {
  BudgetAgentOutput,
  CarRentalAgentOutput,
  CarRentalOption,
  FlightAgentOutput,
  FlightOption,
  HotelAgentOutput,
  HotelOption,
  ItineraryAgentOutput,
} from "@concierge/core";
import type { AgentActivity, ChatMessage } from "./session";

export const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  });

const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

export const hm = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

export interface Selection {
  flight: string | null;
  hotel: string | null;
  car: string | null;
}

export interface Trip {
  flights?: FlightAgentOutput;
  hotels?: HotelAgentOutput;
  cars?: CarRentalAgentOutput;
  itinerary?: ItineraryAgentOutput;
  budget?: BudgetAgentOutput;
  route?: string;
  dates?: string;
  travelers?: number;
  budgetCap?: number;
}

const firstArg = (
  agents: Map<string, AgentActivity>,
  key: string,
): unknown => {
  for (const agent of agents.values())
    for (const call of agent.tools)
      if (call.argsPreview[key] != null) return call.argsPreview[key];
  return undefined;
};

/** The budget the traveler typed, e.g. "under $1,500" → 1500. */
function statedBudget(messages: ChatMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const match = m.text.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\s?k\b)?/i);
    if (match) {
      const n = Number(match[1].replace(/,/g, ""));
      return match[2] ? n * 1000 : n;
    }
  }
  return undefined;
}

export function deriveTrip(
  agents: Map<string, AgentActivity>,
  messages: ChatMessage[],
): Trip {
  const data = <T>(id: string) => agents.get(id)?.data as T | undefined;
  const flights = data<FlightAgentOutput>("flight-agent");
  const hotels = data<HotelAgentOutput>("hotel-agent");
  const cars = data<CarRentalAgentOutput>("car-rental-agent");
  const itinerary = data<ItineraryAgentOutput>("itinerary-agent");
  const budget = data<BudgetAgentOutput>("budget-agent");

  const first = flights?.options?.[0];
  const route = first
    ? `${first.origin} → ${first.destination}`
    : (firstArg(agents, "destination") as string | undefined) ??
      (firstArg(agents, "place") as string | undefined);

  const days = itinerary?.days;
  const start =
    days?.[0]?.date ??
    (firstArg(agents, "checkIn") as string | undefined) ??
    (firstArg(agents, "date") as string | undefined);
  const end =
    (firstArg(agents, "checkOut") as string | undefined) ??
    (firstArg(agents, "returnDate") as string | undefined) ??
    days?.at(-1)?.date;
  const dates =
    start && end && end !== start
      ? `${shortDate(start)} – ${shortDate(end)}`
      : start
        ? shortDate(start)
        : undefined;

  const travelers = Number(
    firstArg(agents, "passengers") ?? firstArg(agents, "guests") ?? 0,
  );

  return {
    flights,
    hotels,
    cars,
    itinerary,
    budget,
    route,
    dates,
    travelers: travelers > 0 ? travelers : undefined,
    budgetCap: budget?.cap?.amount ?? statedBudget(messages),
  };
}

export interface PickedTotal {
  lines: { kind: keyof Selection; label: string; amount: number }[];
  total: number;
}

export function pickedTotal(trip: Trip, picks: Selection): PickedTotal {
  const lines: PickedTotal["lines"] = [];
  const flight = trip.flights?.options.find((f) => f.id === picks.flight);
  if (flight) {
    const people = trip.travelers ?? 1;
    lines.push({
      kind: "flight",
      label: `${flight.carrier} ${flight.flightNumber}${people > 1 ? ` × ${people}` : ""}`,
      amount: flight.fare.amount * people,
    });
  }
  const hotel = trip.hotels?.options.find((h) => h.id === picks.hotel);
  if (hotel)
    lines.push({
      kind: "hotel",
      label: hotel.name,
      amount: hotel.totalForStay.amount,
    });
  const car = trip.cars?.options.find((c) => c.id === picks.car);
  if (car)
    lines.push({
      kind: "car",
      label: `${car.company} ${car.carClass === "suv" ? "SUV" : car.carClass}`,
      amount: car.totalForTrip.amount,
    });
  return { lines, total: lines.reduce((sum, l) => sum + l.amount, 0) };
}

/** Comparison tags computed from the options shown, never invented. */
export function flightTags(options: FlightOption[]): Map<string, string[]> {
  const tags = new Map<string, string[]>(options.map((o) => [o.id, []]));
  if (options.length < 2) return tags;
  const cheapest = minBy(options, (o) => o.fare.amount);
  const fastest = minBy(options, (o) => o.durationMinutes);
  tags.get(cheapest.id)!.push("Cheapest");
  if (fastest.id !== cheapest.id) tags.get(fastest.id)!.push("Fastest");
  return tags;
}

export function hotelTags(options: HotelOption[]): Map<string, string[]> {
  const tags = new Map<string, string[]>(options.map((o) => [o.id, []]));
  if (options.length < 2) return tags;
  tags.get(minBy(options, (o) => o.totalForStay.amount).id)!.push("Lowest price");
  tags.get(minBy(options, (o) => -o.reviewScore).id)!.push("Top rated");
  return tags;
}

export function carTags(options: CarRentalOption[]): Map<string, string[]> {
  const tags = new Map<string, string[]>(options.map((o) => [o.id, []]));
  if (options.length < 2) return tags;
  tags.get(minBy(options, (o) => o.totalForTrip.amount).id)!.push("Lowest price");
  return tags;
}

function minBy<T>(items: T[], score: (item: T) => number): T {
  return items.reduce((best, item) => (score(item) < score(best) ? item : best));
}

const TOOL_LABELS: Record<string, string> = {
  search_flights: "Searching flights",
  get_fare_rules: "Reading fare rules",
  hold_booking: "Placing a hold",
  search_hotels: "Searching places to stay",
  get_hotel_details: "Reading hotel details",
  search_vacation_rentals: "Looking up Airbnb stays",
  get_destination_guide: "Reading the destination guide",
  list_destinations: "Browsing destinations",
  search_car_rentals: "Comparing rental cars",
  get_forecast: "Checking the forecast",
  get_climate_summary: "Reading typical weather",
  search_activities: "Finding things to do",
  convert_currency: "Converting currency",
  lookup_customer: "Finding your profile",
  list_bookings: "Listing your bookings",
  get_booking: "Looking up the booking",
  modify_booking: "Changing the booking",
  cancel_booking: "Cancelling the booking",
  create_ticket: "Opening a support ticket",
};

export function describeTool(tool: string, args: Record<string, unknown>) {
  const label =
    TOOL_LABELS[tool] ??
    tool.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const detail =
    args.origin && args.destination
      ? `${String(args.origin)} → ${String(args.destination)}`
      : args.kind
        ? String(args.kind)
        : ((args.destination ?? args.place) as string | undefined);
  return detail ? `${label} · ${detail}` : label;
}

/** Plain-text plan for the clipboard. Prices stay labeled as estimates. */
export function planText(trip: Trip, picks: Selection): string {
  const out: string[] = [];
  out.push(["Roam trip", trip.route, trip.dates].filter(Boolean).join(" — "));
  if (trip.travelers) out.push(`${trip.travelers} traveler${trip.travelers > 1 ? "s" : ""}`);
  const picked = pickedTotal(trip, picks);
  if (picked.lines.length) {
    out.push("", "Picks (sample prices, not booked):");
    for (const line of picked.lines) out.push(`- ${line.label}: ${usd(line.amount)}`);
    out.push(`Estimated total: ${usd(picked.total)}`);
  }
  for (const day of trip.itinerary?.days ?? []) {
    out.push("", day.dayLabel);
    for (const stop of day.stops) out.push(`- ${stop.timeOfDay}: ${stop.title}`);
  }
  out.push("", "Verify prices and availability before booking.");
  return out.join("\n");
}
