import { z } from "zod";

/**
 * Specialist output schemas — the contract between agents, MCP servers,
 * evals, and the UI component inventory (DESIGN.md §6). If design needs a
 * field, it goes here; if it's here, the UI may render it.
 */

// ── Shared primitives ────────────────────────────────────────────

export const Money = z.object({
  amount: z.number(),
  currency: z.literal("USD"),
});
export type Money = z.infer<typeof Money>;

export const FailedResult = z.object({
  status: z.literal("failed"),
  reason: z.string(),
  suggestion: z.string().optional(),
});

// ── flight-agent → FlightCard ────────────────────────────────────

export const FlightOption = z.object({
  id: z.string(),
  carrier: z.string(),
  flightNumber: z.string(),
  origin: z.string().describe("IATA code, e.g. JFK"),
  destination: z.string().describe("IATA code, e.g. SJU"),
  departLocal: z.string().describe("ISO 8601 local time"),
  arriveLocal: z.string(),
  durationMinutes: z.number().int(),
  stops: z.number().int(),
  fare: Money,
  fareClass: z.string(),
  holdAvailable: z.boolean(),
});
export type FlightOption = z.infer<typeof FlightOption>;

export const FlightAgentOutput = z.object({
  options: z.array(FlightOption).max(5),
  notes: z.string().optional(),
});
export type FlightAgentOutput = z.infer<typeof FlightAgentOutput>;

// ── hotel-agent → HotelCard ──────────────────────────────────────

export const HotelOption = z.object({
  id: z.string(),
  name: z.string(),
  photoUrl: z.string().optional(),
  starRating: z.number().min(1).max(5),
  reviewScore: z.number().min(0).max(5),
  neighborhood: z.string(),
  pricePerNight: Money,
  totalForStay: Money,
  amenities: z.array(z.string()).max(4),
  distanceNote: z.string().describe('e.g. "5 min walk to beach"'),
});
export type HotelOption = z.infer<typeof HotelOption>;

export const HotelAgentOutput = z.object({
  options: z.array(HotelOption).max(5),
  notes: z.string().optional(),
});
export type HotelAgentOutput = z.infer<typeof HotelAgentOutput>;

// ── itinerary-agent → ItineraryDayCard / DestinationCard ─────────

export const ItineraryStop = z.object({
  timeOfDay: z.enum(["morning", "afternoon", "evening"]),
  title: z.string(),
  description: z.string(),
  estimatedCost: Money.optional(),
});

export const ItineraryDay = z.object({
  dayLabel: z.string().describe('e.g. "Day 1 · Fri Mar 14"'),
  date: z.string().describe("ISO date"),
  weather: z
    .object({ summary: z.string(), highF: z.number(), lowF: z.number() })
    .optional(),
  stops: z.array(ItineraryStop).min(1).max(5),
  mealPick: z.string().optional(),
  estimatedDailySpend: Money.optional(),
});
export type ItineraryDay = z.infer<typeof ItineraryDay>;

export const DestinationSuggestion = z.object({
  destination: z.string(),
  pitch: z.string().describe("one-line pitch"),
  avgTempF: z.number().optional(),
  flightPriceFrom: Money.optional(),
});

export const ItineraryAgentOutput = z.object({
  days: z.array(ItineraryDay).optional(),
  destinations: z.array(DestinationSuggestion).optional(),
  dietaryNote: z
    .string()
    .optional()
    .describe('how food picks honor stated restrictions, e.g. "all dinner picks have vegan mains"'),
  notes: z.string().optional(),
});
export type ItineraryAgentOutput = z.infer<typeof ItineraryAgentOutput>;

// ── car-rental-agent → CarRentalCard ─────────────────────────────

export const CarRentalOption = z.object({
  id: z.string(),
  company: z.string(),
  carClass: z.enum(["economy", "compact", "midsize", "suv", "minivan", "convertible"]),
  exampleModel: z.string().describe('e.g. "Toyota Corolla or similar"'),
  seats: z.number().int(),
  pricePerDay: Money,
  totalForTrip: Money,
  pickupLocation: z.string().describe('e.g. "SJU airport" or "Condado downtown"'),
  unlimitedMiles: z.boolean(),
  freeCancellation: z.boolean(),
});
export type CarRentalOption = z.infer<typeof CarRentalOption>;

export const CarRentalAgentOutput = z.object({
  options: z.array(CarRentalOption).max(5),
  notes: z.string().optional(),
});
export type CarRentalAgentOutput = z.infer<typeof CarRentalAgentOutput>;

// ── budget-agent → BudgetMeter ───────────────────────────────────

export const BudgetAgentOutput = z.object({
  cap: Money.optional(),
  segments: z.array(
    z.object({
      label: z.enum(["flights", "stay", "car", "activities", "food", "other"]),
      amount: Money,
    }),
  ),
  total: Money,
  overUnder: z.enum(["under", "at", "over"]),
  topTradeOff: z.string().optional(),
});
export type BudgetAgentOutput = z.infer<typeof BudgetAgentOutput>;

// ── support-agent → BookingCard ──────────────────────────────────

export const BookingStatus = z.enum([
  "confirmed",
  "pending_change",
  "cancelled",
  "refund_issued",
]);

export const SupportAgentOutput = z.object({
  confirmationCode: z.string().optional(),
  tripLabel: z.string().optional(),
  dates: z.string().optional(),
  bookingStatus: BookingStatus.optional(),
  refund: z.object({ amount: Money, method: z.string() }).optional(),
  ticketId: z.string().optional(),
  resolution: z.string(),
});
export type SupportAgentOutput = z.infer<typeof SupportAgentOutput>;
