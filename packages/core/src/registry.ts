import type { AgentDefinition } from "./types.js";
import {
  BudgetAgentOutput,
  FlightAgentOutput,
  HotelAgentOutput,
  ItineraryAgentOutput,
  SupportAgentOutput,
} from "./schemas.js";

const SPECIALIST_RULES = `
Rules:
- Use only your MCP tools for facts. Never invent flights, hotels, prices, or availability.
- Scope: US states and territories only (Puerto Rico, USVI, Hawaii, Alaska, Guam). All money in USD.
- Return your structured output; the "summary" you produce must be one plain sentence, speakable aloud.
- If you cannot complete the task, return status "failed" with a reason and a suggestion — never a partial guess.
- If a required fact is missing and materially changes the result, return status "needs_input" naming exactly what you need.`;

/**
 * The fixed specialist roster (README §2.2). The orchestrator can only
 * delegate to agents listed here — adding a capability means adding an entry.
 */
export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: "flight-agent",
    description:
      "Searches and compares US domestic + territory flights and can place holds. Input: origin/destination (city or IATA), dates, party size, cabin/budget constraints. Returns up to 5 FlightOption results with fares, stops, and hold availability. Not for hotels, itineraries, or existing bookings.",
    systemPrompt: `You are the flight specialist for a US leisure travel agency. Find the best-fit flights for the task using your tools, favoring direct flights and value-for-money. Compare across carriers and note fare rules when relevant.${SPECIALIST_RULES}`,
    mcpServers: ["mcp-travel"],
    maxSteps: 8,
    outputSchema: FlightAgentOutput,
  },
  {
    id: "hotel-agent",
    description:
      "Searches hotels, resorts, and boutique stays by area, budget, dates, and party size. Returns up to 5 HotelOption results with nightly and total prices, ratings, and location notes. Not for flights or activity planning.",
    systemPrompt: `You are the stays specialist for a US leisure travel agency. Find well-reviewed options matching the customer's vibe and budget; include one stretch option and one value option when possible.${SPECIALIST_RULES}`,
    mcpServers: ["mcp-travel"],
    maxSteps: 8,
    outputSchema: HotelAgentOutput,
  },
  {
    id: "itinerary-agent",
    description:
      "Builds weather-aware day-by-day itineraries and compares candidate destinations. Input: destination (or 'suggest destinations' + preferences), dates, interests. Checks the forecast before recommending outdoor days. Returns ItineraryDay list and/or DestinationSuggestion list. Not for booking anything.",
    systemPrompt: `You are the itinerary specialist for a US leisure travel agency. Plan realistic days (3-5 stops, grouped by time of day), always checking weather before scheduling outdoor activities, and include one food pick per day.${SPECIALIST_RULES}`,
    mcpServers: ["mcp-weather", "mcp-travel"],
    maxSteps: 10,
    outputSchema: ItineraryAgentOutput,
  },
  {
    id: "budget-agent",
    description:
      "Reconciles total trip cost against the customer's budget cap. Input: the cap plus the candidate flights/hotels/activities already found (pass them in context). Returns a segmented BudgetAgentOutput with over/under status and the best trade-off suggestion. Performs currency conversion if needed. Does not search for anything itself.",
    systemPrompt: `You are the budget specialist for a US leisure travel agency. Sum the candidate selections passed to you, compare against the cap, and propose the single highest-leverage trade-off if over budget (e.g. "drop to 3-star, keep the direct flight").${SPECIALIST_RULES}`,
    mcpServers: ["mcp-travel"],
    maxSteps: 6,
    outputSchema: BudgetAgentOutput,
  },
  {
    id: "support-agent",
    description:
      "Handles existing bookings: lookup, modify, cancel, refund status, and escalation tickets. Input: customer identity (customerId or email) and the booking in question. DESTRUCTIVE actions (cancel, modify) must only be delegated after the customer has explicitly confirmed. Returns SupportAgentOutput with booking status and resolution.",
    systemPrompt: `You are the support specialist for a US leisure travel agency. Look up the customer and booking before acting. Never cancel or modify without the confirmation flag in your task context. When you cannot resolve, open an escalation ticket and say so.${SPECIALIST_RULES}`,
    mcpServers: ["mcp-agency"],
    maxSteps: 8,
    outputSchema: SupportAgentOutput,
  },
];

export const agentById = (id: string): AgentDefinition | undefined =>
  AGENT_REGISTRY.find((a) => a.id === id);
