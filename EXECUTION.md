# Concierge — Execution Log

> **The third doc in the trinity.** [README.md](README.md) says what we're building, [DESIGN.md](DESIGN.md) says how it looks — this file says **what has actually been built, when, and what's next**. Rule: **every change to code or docs updates this file in the same commit.** If it's not logged here, it didn't happen.

**Repo:** https://github.com/rohansawant07/voice-agentic-ai · **Stack:** TypeScript monorepo (pnpm) · AI SDK v7 + Claude · MCP · Fastify · Next.js (planned) · EKS/Helm (planned)

---

## Status Board

| # | Milestone | Status | Commit(s) |
|---|---|---|---|
| 1 | Docs: model & cost decisions locked | ✅ done | `98b23ab` |
| 2 | M0 — monorepo, core types, agent registry, CI | ✅ done | `33ac1ac` |
| 3 | M1 — 3 MCP servers (travel/weather/agency, mock data) | ✅ done | `dbd4583` |
| 4 | M1 — orchestrator text loop, parallel fan-out, WS feed | 🟡 code complete — live demo blocked on `ANTHROPIC_API_KEY` | `2409022` |
| 5 | M2 — voice pipeline (STT/TTS) | ⬜ not started | |
| 6 | M2 — Next.js web UI (split pane, canvas, orb) | ⬜ not started | |
| 7 | M3 — evals (golden dataset, judges, tracing) | ⬜ not started | |
| 8 | M4 — Docker, compose, Helm on k3d | ⬜ not started | |
| 9 | M5 — AWS (EKS, ECR, OIDC deploy, secrets, ALB) | ⬜ not started | |
| 10 | M6 — hardening (HPA, alarms, online evals) | ⬜ not started | |

**Current blocker:** no `ANTHROPIC_API_KEY` in the dev environment — everything boots and connects (16 MCP tools discovered, `/readyz` green) but the live LLM fan-out demo hasn't run yet. Unblock: `echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env && ./scripts/dev.sh`.

---

## How to run what exists today

```bash
pnpm install
./scripts/dev.sh          # starts mcp-travel :8101, mcp-weather :8102, mcp-agency :8103, orchestrator :8080

# text loop (M1 demo)
curl -s localhost:8080/api/chat -H 'content-type: application/json' \
  -d '{"message":"plan me a long weekend in San Juan under $1500 for two, flying from JFK"}'

# live agent activity feed
websocat 'ws://localhost:8080/ws?sessionId=<id from response>'
```

Checks: `pnpm lint && pnpm typecheck && pnpm build` (also CI on every push).

---

## Changelog

### 2026-08-21 — Docs + M0 + M1

- **`1e8d010` docs**: README.md (architecture brain: agent roster, MCP servers, voice pipeline, EKS deployment, evals, milestones, decision log) and DESIGN.md (design brain: principles, scenarios S1–S7, split-pane UI spec, component inventory, voice UX, design tokens, build order D1–D8).
- **`98b23ab` docs**: model split locked — **Opus 4.8 orchestrator / Sonnet 5 specialists / Haiku 4.5 judges** ("Opus 5" doesn't exist; Fable 5 rejected: 2× cost + too deliberate for the ≤2s voice budget). Cost model added (README §7.5: ≈$0.20/happy path uncached, ~$0.10–0.12 cached, $0.50–0.80/conversation). Wispr Flow excluded (consumer app, no API) — STT is Deepgram/Whisper.
- **`33ac1ac` M0**: pnpm workspace monorepo; `packages/core` — `AgentDefinition`, Zod output schemas for all 5 specialists (the design↔types contract of DESIGN §6), WS `SessionEvent` union, static 5-agent registry with routing descriptions; ESLint + CI (lint/typecheck/build).
- **`dbd4583` M1 MCP servers**: `packages/mcp-kit` (stateless streamable-HTTP serving + healthz/readyz + seeded PRNG); `mcp-travel` (8 tools, deterministic inventory for 8 US destinations, `hold_booking` gated on `confirmed:true` + audit log); `mcp-weather` (Open-Meteo live + deterministic mock mode for evals); `mcp-agency` (seeded customers/bookings, refund policy, destructive tools gated + audited, tickets). Smoke-tested: health + MCP initialize handshake.
- **`2409022` M1 orchestrator**: Fastify :8080 — `POST /api/chat` text loop, `GET /ws` activity feed (`delegation_started` / `tool_called` / `delegation_finished` with masked args), session memory. Opus 4.8 orchestrator with per-registry `delegate_to_*` tools (parallel fan-out, spoken-style rules, destructive-confirmation protocol, cache-friendly frozen system prompt); Sonnet 5 specialists over scoped MCP toolsets returning structured `DelegationResult` envelopes. **Note:** built on AI SDK **v7** (v7.0.70 — `isStepCount`, `Output.object`, `@ai-sdk/mcp`), newer than the v6 in the original README plan.
- **`1183f00` chore**: `scripts/dev.sh` runs the full M1 stack.

---

### 2026-08-21 — Model split revision: Haiku specialists

- Specialists downgraded **Sonnet 5 → Haiku 4.5** — they're narrow, dedicated tool tasks; only orchestration keeps the big model (Opus 4.8). Judges move **Haiku → Sonnet 5** (keeps judge ≠ agent models). Happy path drops **$0.20 → ~$0.13** uncached (~$0.08–0.10 cached); conversation ~$0.35–0.55. Per-agent `model` override stays as the escape hatch if evals show Haiku fumbling a specific specialist. Touched: README §2.2/§7.2/§7.5/§8/decision 5a, `.env.example`, `specialist.ts`, DESIGN §7.
- Voice architecture Q&A: Deepgram is **STT only** (ears), Claude does all reasoning, OpenAI TTS speaks — a deliberate cascade rather than a realtime speech-to-speech model, to keep the orchestrator/specialist structure, model choice, and evals.

### 2026-08-21 — Diagrams upgraded to Mermaid

- README §1 system diagram and §6 deployment diagram replaced ASCII art with **Mermaid** (GitHub renders it natively; stays version-controlled, no image files). DESIGN.md ASCII wireframes intentionally kept — they're UI wireframes, not architecture.

## FAQ / recurring decisions

**"Why Vercel if we deploy on AWS + Kubernetes?"** We don't use Vercel — the platform — anywhere. The **AI SDK** (`ai` npm package) is an open-source MIT *library* that happens to be maintained by Vercel, the same way React is maintained by Meta. It runs in any Node process, including our containers on EKS. We chose it for three things: the agent tool-loop, the built-in **MCP client** (core to our architecture), and model/provider abstraction via env vars. No Vercel account, hosting, key, or service exists in this stack; the deploy target is unchanged: **Docker → ECR → EKS via Helm** (README §6). If we ever want zero Vercel-adjacent code, the swap is the Anthropic SDK + hand-rolled MCP wiring — tracked as decision #11 in README §10.

---

## Update protocol (for every future change)

1. Make the change (code or docs).
2. If it contradicts README/DESIGN → fix them in the same commit (their own rule).
3. Add a changelog line here + update the Status Board.
4. One commit, pushed to `main`. CI must be green.
