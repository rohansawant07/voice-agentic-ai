# Roam

A voice-enabled travel planning prototype for the US and its territories. Talk or type to a travel companion; flights, stays, itineraries and budgets appear on a trip board while specialist activity is visible alongside them.

**Status: working local prototype, not a hosted booking service.** Trip board redesigned and verified October 27, 2026. The repository is public. An AWS deploy kit is ready ([deploy/aws](deploy/aws/README.md)), but no public application URL is live yet. Flights, hotels, rental cars and agency bookings use demo data. Airbnb defaults to direct search links, not live availability.

## Container preview

The protected Docker version runs at **http://localhost:3080**. Follow [container setup](deploy/README.md); the setup script stores your local login in `.secrets/tester-login.txt`. Seven services run locally, including PostgreSQL. To host it with HTTPS on AWS (one EC2 host, about $21/month), run `deploy/aws/deploy.sh up` from a signed-in AWS CLI; see [AWS deployment](deploy/aws/README.md).

## Run locally

Prerequisites: Node.js **22 or newer**, pnpm **11.22.0**, and an Anthropic API key with access to the configured models.

```bash
git clone https://github.com/rohansawant07/voice-agentic-ai.git
cd voice-agentic-ai
pnpm install --frozen-lockfile
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY. Keep voice providers as none for text-only.
pnpm build
./scripts/dev.sh
```

Open **http://localhost:3000**. The script loads the root `.env` and starts five processes on ports 3000, 8080, 8101, 8102 and 8103. Start with those ports free. It sets each service's port separately so a global environment variable cannot put all services on the same port. Stop the stack with Ctrl+C. Package names still use the internal `@concierge/*` scope.

For voice input, set `VOICE_STT=deepgram` and `DEEPGRAM_API_KEY`, then restart the stack. Spoken replies are separate: set `VOICE_TTS=openai` plus `OPENAI_API_KEY`, or configure ElevenLabs. Deepgram credits currently cover transcription only. Voice uses recorded utterances, not live streaming recognition.

Individual package commands do **not** load root `.env` automatically. If running services separately, export the relevant variables yourself. Do not run a Next.js production build over a running development server's `.next` output; stop the web process, build, then restart it.

## Can someone else test it?

- **Yes, by cloning the public repository** and running the setup above with their own keys.
- **Not by opening your localhost link.** On their device, `localhost` means their own machine.
- A browser-only test needs a hosted frontend and reachable HTTP/WebSocket backend, or a protected temporary tunnel to both. HTTPS is needed for microphone use off localhost. A local protected Docker deployment is configured. The AWS kit provides HTTPS and Basic auth, but no AWS deployment is active yet.
- Before sharing your running backend, add access control and request limits. Direct development mode has no authentication. The container gateway now adds Basic authentication, session ownership scoping and request limits, but no per-user billing quota. CORS is not authentication; clients without an Origin header can call the backend. Shared demo agency mutations affect the same in-memory data.

See [testing and hosting requirements](docs/OPERATIONS.md). No deployment is triggered by pushing to GitHub.

## What works today

| Area | Implemented behavior |
| --- | --- |
| Conversation | Text requests, session history, same-session overlapping model turns rejected |
| Voice | Deepgram Nova-3 or Whisper transcription; optional OpenAI or ElevenLabs synthesis |
| UI | Responsive conversation / trip board; trip summary with picks, estimated total vs. budget and copyable plan; comparison rows with computed tags; live skeletons and step labels; day-tab itinerary; planning-activity timeline; follow-up suggestions; refresh-safe sessions with socket reconnect |
| Specialists | Six registered specialists: flight, hotel, itinerary, car rental, budget, support |
| Travel | Seeded flights/hotels/cars/activities; dietary filters; car rentals offered only when relevant/requested |
| Regional plans | Curated NPS planning facts for Harpers Ferry and Shenandoah, independent of hotel inventory |
| Airbnb | Dated destination search links by default; opt-in independent connector with bounded concurrency/time and honest fallback |
| Weather | Live Open-Meteo forecast/geocoding; static climate table; optional mock weather |
| Agency | Seeded customers/bookings, simulated modifications/cancellations, tickets and audit records |
| Validation | Shared Zod schemas, HTTP input validation, deterministic regression and PostgreSQL integration tests, CI |

Card selection is visual-only: it does not book anything or update the next model turn. No real reservation, payment, refund or ticket submission to a travel provider occurs. The opt-in Airbnb connector is not an official Airbnb integration; the live access check was restricted.

## Architecture

```mermaid
flowchart LR
  U["Browser: localhost:3080"] --> G["nginx gateway: Basic auth + request limits"]
  G -->|Pages and assets| WEB["Next.js :3000"]
  G <-->|"/api/chat, /ws, /voice"| O["Fastify orchestrator :8080"]
  O <--> DB["PostgreSQL: history, events, shared turn locks"]
  O --> AI["Claude orchestrator + six specialist calls"]
  O <-->|Recorded speech / optional synthesis| VOICE["Deepgram STT / optional TTS provider"]
  AI --> T["Travel MCP :8101: mocks, guides, Airbnb links"]
  AI --> W["Weather MCP :8102: Open-Meteo"]
  AI --> A["Agency MCP :8103: read-only demo in Compose"]
```

Specialists run inside the orchestrator process; they are not six deployed workers. Independent delegations can run concurrently. The orchestrator and specialists use Anthropic through AI SDK v7. Defaults are `claude-opus-4-8` and `claude-haiku-4-5`, respectively; both are configurable. See [ARCHITECTURE.md](ARCHITECTURE.md) for the actual lifecycle and boundaries.

## Database and cache

The default `scripts/dev.sh` mode remains in-memory unless `DATABASE_URL` is set. The [Docker pilot](deploy/README.md) now configures PostgreSQL with persistent volumes, scoped identities, shared turn locks, bounded history and a shared activity log. No Redis is required.

### Direct local-development mode

Without `DATABASE_URL`, conversations and agency demo records are process-local. With it, migration `services/orchestrator/migrations/001-state.sql` is applied at startup and conversation/event state uses PostgreSQL. Agency demo records are not migrated; their mutations are disabled in Compose. There is no SQLite fallback or Redis.

| State / cache | Where it lives | Retention and limits |
| --- | --- | --- |
| Conversation history | Orchestrator `Map`, keyed by session ID | Successful user/assistant pairs only; no TTL or size bound; lost on restart |
| Active-turn guard | Orchestrator `Set` | Released after each model turn; process-local only |
| Activity replay | Orchestrator event bus | Up to 500 events per session; no session expiry or global bound |
| Customers/bookings/tickets/audit | Agency arrays | Shared demo store; mutations lost on agency restart |
| MCP tool definitions | Orchestrator `Map` | Discovered once at startup; no automatic refresh |
| Search/weather/model responses | No application result cache | Repeated requests repeat tool/provider work |
| Provider prompt cache | No explicit cache configuration or hit metrics | Stable prompt ordering exists; savings/hits are not verified |

Browser state is also in memory: refresh creates a new session and clears the visible trip. These constraints apply to direct in-memory mode. PostgreSQL mode coordinates history, locks and events across instances; the single-host pilot is not high availability. See [operations](docs/OPERATIONS.md) for the suggested next steps.

## Measured performance

A reproducible local benchmark and raw observations are in [PERFORMANCE.md](docs/PERFORMANCE.md) and [the benchmark data](docs/benchmarks/2026-10-26-local.json). These are serial development-machine measurements, **not** a production SLA or capacity test. HTTP liveness response time is not planning latency.

| Scenario | Median | Slowest of 3 runs |
| --- | --- | --- |
| Clarifying text reply | 2.33 s | 2.96 s |
| Harpers Ferry itinerary | 17.21 s | 20.74 s |
| Multi-specialist San Juan trip | 38.10 s | 46.33 s |
| Synthetic voice clip → transcript, after audio end | 0.26 s | 0.78 s |

All nine text requests returned HTTP 200; one specialist attempt failed and recovered on retry. Voice used a 5.392-second synthetic clip. Recording time is excluded, TTS was off, and first audible reply latency remains unmeasured. Small-sample p95 is just the maximum here; it is not a production tail estimate.

```bash
# Health/page response timing only; no model calls
node scripts/benchmark.mjs --output docs/benchmarks/latest.json

# Three fresh-session requests per scenario; uses paid model requests
node scripts/benchmark.mjs --live --runs 3 --output docs/benchmarks/latest.json
```

Existing activity events record total model-turn and specialist duration. There is no metrics dashboard, token/cost accounting, per-tool duration, cache-hit reporting, or STT/TTS timing instrumentation. The old two-second voice target was a goal, not a measured achievement. The browser waits for `tts_end` before playback.

## Configuration

[.env.example](.env.example) lists the implemented settings. Keep actual secrets in ignored `.env` files and server-side only. `NEXT_PUBLIC_ORCH_URL` is deliberately public and must be set **before building** a deployed frontend. `WEB_ORIGIN` must match its exact origin. Internal MCP URLs should not be publicly exposed.

`DATABASE_URL` now enables PostgreSQL conversation/event persistence. `AUTH_MODE=proxy` and `GATEWAY_TOKEN` protect deployed backend access. `REDIS_URL`, `LANGFUSE_*`, `JUDGE_MODEL`, `TRAVEL_PROVIDER` and Amadeus credentials remain unimplemented placeholders. Docker Compose and a single-host AWS stack (CloudFormation, Caddy HTTPS, SSM secrets, daily snapshots) are present; Helm, EKS, an active AWS deployment, tracing and golden-dataset evals are not.

## Development

```bash
pnpm lint
pnpm typecheck       # builds workspace, then checks types
pnpm test           # deterministic tests; PostgreSQL integration requires TEST_DATABASE_URL
pnpm build
```

CI runs these checks on pushes to `main` and pull requests. It does not deploy or run live-provider benchmarks. For a production-mode local web server, run the web build and `pnpm --filter @concierge/web start`; the backend services must also be running.

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js app and browser session hook |
| `services/orchestrator` | Chat, voice, model delegation, session store and event bus |
| `services/mcp-travel` | Mock travel inventory, official-source guides, Airbnb link/connector logic |
| `services/mcp-weather` | Open-Meteo and static climate data |
| `services/mcp-agency` | Simulated customer and booking operations |
| `packages/core` | Registry, schemas, event contracts |
| `packages/mcp-kit` | Shared stateless HTTP MCP server |
| `scripts` | Local launcher and latency benchmark |
| `.agents/skills` | Imported design, accessibility and React guidance |

Project-local UI skills are documented in [SOURCES.md](.agents/skills/SOURCES.md), with pinned revisions and attribution. Their upstream README is kept intact. See [AGENTS.md](AGENTS.md) for routing.

## Project documents

- [Project handoff](MEMORY.md): durable project context, constraints and next steps.
- [Architecture](ARCHITECTURE.md): implemented topology and data flow.
- [Interface design](DESIGN.md): current UI and behavior.
- [Operations](docs/OPERATIONS.md): sharing, state/cache design and deployment gaps.
- [Performance](docs/PERFORMANCE.md): method, measurements and limitations.
- [Execution history](EXECUTION.md): current status and historical changes.
