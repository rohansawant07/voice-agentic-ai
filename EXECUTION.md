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
| 4 | M1 — orchestrator text loop, parallel fan-out, WS feed | ✅ done — live demo ran (clarify → 4-agent fan-out → $1,220/$1,500) | `2409022` |
| 5 | M2 — voice pipeline (STT/TTS) | 🟡 STT live-verified (Deepgram); TTS code done, awaiting OpenAI/ElevenLabs key | `b59d390` `7ca22ce` |
| 6 | M2 — Next.js web UI (split pane, canvas, orb) | ✅ done — live multi-turn demo in browser incl. voice input | `9096029` |
| 7 | M3 — evals (golden dataset, judges, tracing) | ⬜ not started | |
| 8 | M4 — Docker, compose, Helm on k3d | ⬜ not started | |
| 9 | M5 — AWS (EKS, ECR, OIDC deploy, secrets, ALB) | ⬜ not started | |
| 10 | M6 — hardening (HPA, alarms, online evals) | ⬜ not started | |

**Current blocker:** none. `ANTHROPIC_API_KEY` + `DEEPGRAM_API_KEY` are in local `.env` (gitignored); text loop, UI, and voice input all ran live. Spoken *replies* need an `OPENAI_API_KEY` (+ `VOICE_TTS=openai`) — optional.

**Known gaps (tracked for M3+):**
- Card selection is visual-only — the ✓ doesn't yet recompute the budget meter or inform the orchestrator on the next turn (DESIGN §5.2 selection model; stub in `page.tsx onSelectionChange`).
- Full fan-out turn ≈60–80s — far above the ≤2s first-spoken-token budget; needs streaming + tracing (M3).
- Weather specialist mis-geocoded "San Juan" in one live run and gracefully failed — seed case for the golden dataset.

---

## How to run what exists today

```bash
pnpm install
./scripts/dev.sh          # starts mcp-travel :8101, mcp-weather :8102, mcp-agency :8103, orchestrator :8080, web UI :3000

# open the split-pane UI (M2)
open http://localhost:3000

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

### 2026-08-21 — M2 voice pipeline (backend)

- **M2 voice backend**: `voice/stt.ts` (Deepgram nova-3 primary, OpenAI whisper-1 fallback, `none` = text-only — all via `VOICE_STT`), `voice/tts.ts` (OpenAI `gpt-4o-mini-tts` / ElevenLabs turbo streaming, via `VOICE_TTS`), and a `/voice` WebSocket: binary mic frames in → `audio_end` → STT → shared `runTurn` → `reply` JSON + streamed TTS audio chunks (`tts_start`/binary/`tts_end`), with `cancel` for barge-in and a `text` message type so the socket works keyless. Session turns extracted to `sessions.ts` (shared by `/api/chat` and `/voice`); `@fastify/cors` added for the Next.js dev origin; `/healthz` now reports voice capability. Smoke-tested: `/voice` handshake + disabled-STT guard respond correctly. Live audio still needs `DEEPGRAM_API_KEY`/`OPENAI_API_KEY` (and `ANTHROPIC_API_KEY` for the turn itself).

### 2026-08-21 — Live browser session (M2 demo walked)

- Full multi-turn session in the real UI: clarifying question → date negotiation ("cheapest live dates in December") → 4-night plan under the $1,500 cap with flight/hotel cards and a day-by-day itinerary on the canvas; hotel card selection (✓) exercised; voice input used live after the recorder fixes below. Status board updated: M1 ✅ live, M2 UI ✅ live, M2 voice 🟡 (STT live, TTS awaiting key). Known gaps promoted to their own list above (selection stub, fan-out latency, weather geocode case).

### 2026-08-21 — First live runs + voice input bugfixes

- **First live LLM demo ran** (key now in local `.env`): clarifying question on ambiguous dates, then full parallel fan-out — flights + hotel + itinerary + budget, ≈$1,220 vs the $1,500 cap, honest hurricane-season caveat. Full fan-out turn took ~80s — latency work deferred to M3 tracing.
- **Voice input fixed after real-browser testing**: rapid orb taps / held-Space auto-repeat spawned multiple parallel MediaRecorders whose chunks interleaved into one server buffer → Deepgram 400 "corrupt data", plus stranded "…" placeholder bubbles. Fixes: single-recorder guard + `e.repeat` ignore, `audio_reset` control message (server drops stale chunks per utterance), placeholder cleanup on STT error, Safari support via `audio/mp4` fallback when webm is unsupported.
- **Voice verified end-to-end without a mic**: macOS `say` → wav → `/voice` WS → Deepgram transcript (word-perfect) → orchestrator → specialist → reply. STT is live; TTS still off (no OpenAI/ElevenLabs key yet).
- Weather specialist mis-matched "San Juan" in Open-Meteo geocoding on the live run and correctly returned a graceful failure instead of guessing — candidate M3 eval case.

### 2026-08-21 — Security hardening (post-review, pre-M3)

- Security review of the M2 diff found no exploitable vulnerabilities; the one dismissed candidate (permissive CORS + unchecked WS origins on the unauthenticated dev stack) was fixed anyway as pre-M5 hardening:
  - **CORS allowlist**: `origin: true` → `origin: [WEB_ORIGIN]` (env, default `http://localhost:3000`).
  - **WS origin checks**: `/ws` and `/voice` upgrades reject browser Origins ≠ `WEB_ORIGIN` (close 1008); origin-less non-browser clients (websocat, evals, curl) still allowed — the check defends against drive-by pages, not CLIs.
  - **Loopback bind**: orchestrator and all MCP servers bind `HOST` env, default `127.0.0.1` (was `0.0.0.0`); containers/EKS will set `HOST=0.0.0.0` in M4/M5 manifests.
- Verified live: allowed origin gets ACAO, evil-origin preflight gets none, evil-origin WS upgrade closed 1008, no-origin WS still connects. `.env.example` gained `HOST`/`WEB_ORIGIN`.

### 2026-08-21 — Docs sync after M2

- **README**: milestones M0–M2 checked off (with a pointer here for the API-key caveat); the two stale **AI SDK v6** references corrected to **v7** (§2.1 loop row, decision #5); §2.1 `respond_to_customer` tool removed — in the built code the orchestrator's final assistant text *is* the customer reply, there is no separate respond tool.
- **DESIGN §9**: build-order table gained a Status column — D1/D2/D5 ✅, D3/D4/D6/D8 🟡 with the exact gaps named (ConfirmationCard + Storybook page, audio-reactive orb energy, node detail sheet, AA audit sweep), D7 ⬜.

### 2026-08-21 — M2 web UI (apps/web)

- **M2 web UI**: Next.js 15 app (`apps/web`, port 3000) implementing DESIGN §5 — split-pane session screen (conversation 40% / canvas 60%), Results tab (FLIGHTS/STAYS/ITINERARY/BUDGET/BOOKINGS sections appear per specialist with live status chips, card entrance motion, failed-state notes), Agents tab (orchestrator fan-out, per-node state/duration, tool-call ticker with masked args), bottom bar (CSS orb with idle/listening/thinking/speaking states, Space = PTT, Esc = stop speaking, always-visible text field). Design tokens from DESIGN §8 as CSS variables, light + dark, `prefers-reduced-motion` respected. Cards typed directly off `@concierge/core` schemas (FlightOption, HotelOption, ItineraryDay, BudgetAgentOutput, SupportAgentOutput). Client wires `/ws` (activity feed) + `/voice` (mic frames up via MediaRecorder, TTS audio down, barge-in cancel) + `POST /api/chat` (text fallback).
- **Verified without API keys**: Playwright screenshots in light + dark, zero page errors (fixed an SSR hydration mismatch by making sessionId client-only), and a scratchpad mock orchestrator replaying a canned San Juan event stream — all card types, status chips, and the agents graph rendered correctly.
- **Deviation from DESIGN**: Orb is hand-rolled CSS (orb-ui kept as anatomy reference only — no extra dependency); DESIGN §5.3/§6 amended. TTS playback buffers per-utterance (Blob → Audio) rather than streaming via MediaSource — fine for M2, revisit if first-audible-token latency misses budget. Deferred to later steps: map panel with pins, suggestion/clarify chips from live model output, confirmation card wiring, karaoke highlight (D7/D8).
- `scripts/dev.sh` now also starts the web app; `pnpm-workspace.yaml` allows the sharp build; root ESLint ignores generated `next-env.d.ts`.

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
