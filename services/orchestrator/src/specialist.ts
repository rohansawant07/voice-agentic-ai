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

const SPECIALIST_MODEL = process.env.SPECIALIST_MODEL ?? "claude-sonnet-5";

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
function instrument(tools: ToolSet, sessionId: string, agentId: string): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = {
      ...t,
      execute: async (args: unknown, opts: unknown) => {
        bus.emit({
          type: "tool_called",
          sessionId,
          ts: Date.now(),
          agentId,
          tool: name,
          argsPreview: maskArgs(args),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (t as any).execute(args, opts);
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
    data: (def.outputSchema as z.ZodTypeAny).optional(),
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
  bus.emit({
    type: "delegation_started",
    sessionId,
    ts: started,
    agentId: def.id,
    task: req.task,
  });

  let result: DelegationResult;
  try {
    const { output } = await generateText({
      model: anthropic(def.model ?? SPECIALIST_MODEL),
      system: def.systemPrompt,
      tools: instrument(toolsFor(def.mcpServers), sessionId, def.id),
      stopWhen: isStepCount(def.maxSteps),
      output: Output.object({ schema: resultSchema(def) }),
      prompt: `Task: ${req.task}\n\nKnown context:\n${JSON.stringify(req.context ?? {}, null, 2)}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}`,
    });
    result = output as DelegationResult;
  } catch (err) {
    result = {
      status: "failed",
      summary: `The ${def.id.replace("-agent", "")} lookup hit a problem.`,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  bus.emit({
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
