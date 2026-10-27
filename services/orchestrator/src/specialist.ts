import { generateText, isStepCount, Output, type ToolSet } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type {
  AgentDefinition,
  DelegationRequest,
  DelegationResult,
} from "@concierge/core";
import { bus } from "./bus.js";
import { toolsFor } from "./mcp.js";

const SPECIALIST_MODEL = process.env.SPECIALIST_MODEL ?? "claude-haiku-4-5";

/** Sensitive keys masked before tool args reach the activity feed. */
const MASK_KEYS = new Set(["customerId", "email", "authorization", "token"]);

function maskArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null) return {};
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([k, v]) => [
      k,
      MASK_KEYS.has(k) ? "•••" : v,
    ]),
  );
}

/** Wrap MCP tools so every invocation lands on the session event bus. */
function instrument(tools: ToolSet, sessionId: string, agentId: string,
  provenance: { unpricedGuide: boolean }): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = {
      ...t,
      execute: async (args: unknown, opts: unknown) => {
        await bus.emit({
          type: "tool_called",
          sessionId,
          ts: Date.now(),
          agentId,
          tool: name,
          argsPreview: maskArgs(args),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (t as any).execute(args, opts);
        const envelope = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).safeParse(result);
        for (const item of envelope.success ? envelope.data.content : []) {
          if (item.type !== "text" || !item.text) continue;
          try {
            const payload = JSON.parse(item.text) as { source?: string; pricesVerified?: boolean };
            if ((payload.source === "curated-official-guide" || payload.source === "wikivoyage") && payload.pricesVerified === false) provenance.unpricedGuide = true;
          } catch { /* Not every tool returns JSON text. */ }
        }
        return result;
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
  return wrapped;
}

/** Envelope the specialist fills — data validated against its outputSchema. */
function resultSchema(def: AgentDefinition) {
  return z.object({
    status: z.enum(["ok", "failed", "needs_input"]),
    data: (def.outputSchema as z.ZodTypeAny).nullable().describe(
      "REQUIRED: fill the complete specialist result for status ok, including cards, links, days and sources. Use null only for failed or needs_input.",
    ),
    summary: z
      .string()
      .describe("One plain speakable sentence digest of the result"),
    reason: z.string().optional(),
    suggestion: z.string().optional(),
  });
}

export async function runSpecialist(
  def: AgentDefinition,
  req: DelegationRequest,
  sessionId: string,
): Promise<DelegationResult> {
  const started = Date.now();
  await bus.emit({
    type: "delegation_started",
    sessionId,
    ts: started,
    agentId: def.id,
    task: req.task,
  });

  const provenance = { unpricedGuide: false };
  let result: DelegationResult;
  try {
    const { output } = await generateText({
    abortSignal: AbortSignal.timeout(60000),
      model: anthropic(def.model ?? SPECIALIST_MODEL),
      system: def.systemPrompt,
      tools: instrument(toolsFor(def.mcpServers), sessionId, def.id, provenance),
      stopWhen: isStepCount(def.maxSteps),
      output: Output.object({ schema: resultSchema(def) }),
      prompt: `Task: ${req.task}\n\nKnown context:\n${JSON.stringify(req.context ?? {}, null, 2)}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}`,
    });
    result = output as DelegationResult;
    // Curated and community guides contain no verified prices: never display invented totals.
    if (def.id === "itinerary-agent" && provenance.unpricedGuide && result.data) {
      const data = result.data as { days?: { estimatedDailySpend?: unknown; stops: { estimatedCost?: unknown }[] }[]; notes?: string };
      for (const day of data.days ?? []) {
        delete day.estimatedDailySpend;
        for (const stop of day.stops) delete stop.estimatedCost;
      }
      data.notes = `${data.notes ?? ""} Activity fees and daily spending have not been verified; no cost totals are shown.`.trim();
    }
    if (result.status === "ok" && result.data == null) {
      result = { status: "failed", summary: "The specialist did not return usable results.", reason: "missing_structured_data" };
    }
  } catch (err) {
    result = {
      status: "failed",
      summary: `The ${def.id.replace("-agent", "")} lookup hit a problem.`,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  await bus.emit({
    type: "delegation_finished",
    sessionId,
    ts: Date.now(),
    agentId: def.id,
    status: result.status,
    summary: result.summary,
    data: result.data,
    durationMs: Date.now() - started,
  });
  return result;
}
