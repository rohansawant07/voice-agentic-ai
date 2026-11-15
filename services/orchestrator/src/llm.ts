import { anthropic, createAnthropic } from "@ai-sdk/anthropic";

const GATEWAY_URL = process.env.LLM_GATEWAY_URL?.trim() || undefined;
const GATEWAY_KEY = process.env.LLM_GATEWAY_KEY?.trim() || undefined;
// Without its own key the provider would fall back to ANTHROPIC_API_KEY and hand the real key to the gateway.
if (GATEWAY_URL && !GATEWAY_KEY) throw new Error("LLM_GATEWAY_URL is set but LLM_GATEWAY_KEY is not");

/**
 * The Claude provider. With LLM_GATEWAY_URL set to LiteLLM's Anthropic pass-through
 * (for example http://localhost:4000/anthropic/v1), every call goes through the gateway
 * with its virtual key, so spend, budgets and request logs live there. Unset, calls go
 * straight to Anthropic with ANTHROPIC_API_KEY.
 */
export const claude = GATEWAY_URL ? createAnthropic({ baseURL: GATEWAY_URL, apiKey: GATEWAY_KEY }) : anthropic;

/** Labels a call in the gateway's spend log (who made it, for which trip); nothing without a gateway. */
export const gatewayTags = (...tags: (string | undefined)[]) =>
  GATEWAY_URL ? { "x-litellm-tags": tags.filter(Boolean).join(",") } : undefined;
