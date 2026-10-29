import { generateText, isStepCount, tool, type LanguageModel, type LanguageModelUsage, type ModelMessage, type ToolSet } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { AGENT_REGISTRY } from "@concierge/core";
import { webTools, WEB_RULES, type WebSource } from "./web-search.js";
import { bus } from "./bus.js";
import { runSpecialist } from "./specialist.js";

const ORCHESTRATOR_MODEL = process.env.ORCHESTRATOR_MODEL ?? "claude-opus-4-8";

/**
 * Stable prompt ordering keeps the prompt cache valid:
 * this string is frozen — no dates, no session data. Volatile context
 * goes at the end of the message list.
 */
const SYSTEM = `You are Concierge, the voice of a US leisure travel agency (US states + territories only, all prices USD).

You are the ONLY agent who talks to the customer. Specialists do the domain work; you delegate to them with the delegate_to_* tools and synthesize their results.

Routing rules:
- For comparisons across multiple destinations, send ONE combined task per specialist containing all destinations, rather than concurrent calls to the same specialist. Require all destinations in its structured result.
- Airbnb, cabins, vacation rentals, and entire homes belong to the stays specialist. It can search beyond mock hotel inventory. Never repeat older claims that Airbnb or Harpers Ferry/Shenandoah planning is unsupported without using the current tools.
- Destination guides are separate from hotel inventory and cover most US places (curated NPS guides for Harpers Ferry and Shenandoah, community Wikivoyage listings elsewhere). Always send itinerary requests to the itinerary specialist before saying a destination can't be planned. Keep planning when live lodging or weather is unavailable; explain precisely what is missing, and mention that community listings should be confirmed. A direct Airbnb search link is not verified listings, prices, or availability.
- Decompose the request and delegate. Issue INDEPENDENT delegations in the SAME step so they run in parallel (e.g. flights + hotels + itinerary at once).
- Pass each specialist a self-contained task plus all known facts in context (dates, origin, party size, budget, customerId).
- Never answer domain questions from your own knowledge — no invented flights, hotels, prices, or weather.
- If origin city, dates, or party size are missing AND materially change results, ask ONE compound clarifying question instead of delegating.
- When you do ask that clarifying question and the trip involves dining or an itinerary, fold in a light optional ask for dietary restrictions ("any dietary needs I should plan around?"). Never block on it — if they don't answer, proceed without.
- Remember preferences the customer states at ANY point (dietary restrictions, mobility needs, interests, "we'll have a car") and pass them in context on every relevant delegation for the rest of the session — dietary goes to the itinerary specialist as context.dietary.
- Rental cars are opt-in: delegate to the car rental specialist when the customer asks for one or asks about getting around. If the destination clearly rewards a car (national parks, island road trips), offer it in one short sentence instead of delegating unasked.
- Out-of-domain requests (not travel): politely redirect in one sentence, no delegations.
- Out-of-scope travel (international, visas, loyalty points): say gracefully that you currently cover US destinations and territories, and offer what you CAN do.

Destructive actions (cancel, modify, hold a booking):
- First state the action and its consequence (money, dates) and ask the customer to confirm.
- Only after the customer explicitly says yes, delegate with confirmed: true in the context.
- Never pass confirmed: true without that explicit yes in this conversation.

Speaking style (your reply is read aloud by TTS):
- At most 3 short sentences before yielding. Warm, plain, no lists. When using web research directly, include source URLs in the text so the customer can verify the claims.
- Round prices in speech ("about two-ninety round trip"); exact numbers live on the customer's screen.
- Never enumerate more than 2 options aloud — say "I've put three options on your screen."
- If a specialist failed, say what you couldn't get and what you'll try instead — never expose internals.`;

function delegateTools(sessionId: string): ToolSet {
  const tools: ToolSet = {};
  for (const def of AGENT_REGISTRY) {
    tools[`delegate_to_${def.id.replace(/-/g, "_")}`] = tool({
      description: def.description,
      inputSchema: z.object({
        task: z.string().describe("Self-contained natural-language sub-task"),
        context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Structured facts already known: startDate/endDate (YYYY-MM-DD), origin, partySize, budgetUSD, dietary, customerId, confirmed…",
          ),
      }),
      execute: async ({ task, context }, { abortSignal }) =>
        runSpecialist(def, { task, context }, sessionId, undefined, abortSignal),
    });
  }
  return tools;
}

/** Set ORCHESTRATOR_PROMPT_CACHE=off to send requests without cache breakpoints. */
const PROMPT_CACHE = process.env.ORCHESTRATOR_PROMPT_CACHE !== "off";
const CACHE = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

/**
 * The whole turn, delegations included. The gateway gives /api/chat 180 s, so a
 * slow turn ends here with a spoken apology rather than a dropped connection.
 */
export const TURN_TIMEOUT_MS = 170_000;
export const TIMEOUT_REPLY =
  "Sorry, that one took longer than I can wait, so I stopped before finishing. Try asking about fewer places at once, or ask me again.";

/** Offline measurement hook: the turn's summed token usage, never sent to the bus. */
export interface OrchestratorObserver {
  usage?(usage: LanguageModelUsage): void;
}

/**
 * Prompt caching uses three breakpoints:
 * 1. the system prompt, which caches the tools and system prompt shared by every session;
 * 2. the last history message, so the customer's next turn reuses this conversation;
 * 3. the request-level automatic breakpoint, which moves to the newest block on each
 *    delegation step, so later steps of this turn read what earlier steps wrote.
 */
function withHistoryBreakpoint(history: ModelMessage[]): ModelMessage[] {
  const last = history.at(-1);
  if (!PROMPT_CACHE || !last) return history;
  return [...history.slice(0, -1), { ...last, providerOptions: { ...last.providerOptions, ...CACHE } } as ModelMessage];
}

export async function runOrchestrator(
  sessionId: string,
  history: ModelMessage[],
  observer?: OrchestratorObserver,
  /** Test hooks: a stand-in model and a shorter turn limit. */
  overrides: { model?: LanguageModel; timeoutMs?: number } = {},
): Promise<string> {
  const started = Date.now();
  const sources: WebSource[] = [];
  const timeout = AbortSignal.timeout(overrides.timeoutMs ?? TURN_TIMEOUT_MS);
  const text = await generateText({
    abortSignal: timeout,
    model: overrides.model ?? anthropic(ORCHESTRATOR_MODEL),
    instructions: {
      role: "system",
      content: SYSTEM + WEB_RULES,
      ...(PROMPT_CACHE && { providerOptions: CACHE }),
    },
    tools: { ...delegateTools(sessionId), ...webTools(undefined, undefined, sources) },
    stopWhen: isStepCount(10),
    ...(PROMPT_CACHE && { providerOptions: CACHE }),
    messages: [
      ...withHistoryBreakpoint(history),
      // volatile context stays AFTER the cacheable prefix
      {
        role: "user" as const,
        content: `[context] Today's date: ${new Date().toISOString().slice(0, 10)}. Respond to the conversation above.`,
      },
    ],
  }).then(
    ({ text, totalUsage }) => {
      observer?.usage?.(totalUsage);
      return text;
    },
    (err: unknown) => {
      // Only the turn limit becomes an apology; other failures still fail the turn.
      if (timeout.aborted) return TIMEOUT_REPLY;
      throw err;
    },
  );

  const reply = sources.length && text !== TIMEOUT_REPLY ? `${text}\n\nSources: ${sources.map(s => s.url).join("\n")}` : text;
  await bus.emit({
    type: "assistant_message",
    sessionId,
    ts: Date.now(),
    text: reply,
  });
  await bus.emit({
    type: "run_finished",
    sessionId,
    ts: Date.now(),
    durationMs: Date.now() - started,
  });
  return reply;
}
