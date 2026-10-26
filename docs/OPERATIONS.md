# Testing and operations

Verified against the code on October 26, 2026. This document describes the current prototype and labels future work explicitly.

## Sharing now

The public repository is https://github.com/rohansawant07/voice-agentic-ai. A tester can clone it, follow the root README, and supply their own provider credentials. Do not send your `.env` file. A fresh browser session has no saved conversation or trip.

There is no hosted frontend/backend, Docker image workflow, Compose stack, tunnel, Helm chart or cloud deployment in this repository. A GitHub link shares source code; it does not run the application.

For someone to use a browser link without installing anything, the deployment must supply:

1. An HTTPS frontend and an HTTPS/WebSocket-capable backend. The browser uses HTTP `/api/chat`, activity WebSocket `/ws`, and voice WebSocket `/voice`.
2. `NEXT_PUBLIC_ORCH_URL=https://<backend-host>` at frontend build time. This is also converted to `wss://` for sockets. Tunneling port 3000 alone leaves the browser pointing at the tester's `localhost:8080` unless this setting changes.
3. `WEB_ORIGIN=https://<frontend-host>` on the orchestrator. This is an exact origin match for browser CORS and WebSocket upgrades.
4. Server-side provider secrets, and private connectivity from the orchestrator to the three MCP services. Keep 8101–8103 private. Bind addresses are loopback by default; set `HOST` appropriately per process when hosting.
5. Access control covering chat **and both WebSocket endpoints**, plus request/concurrency limits and a provider spending cap. The app does not implement these controls. A protected preview must enforce them at the gateway or in the app.
6. One orchestrator instance until shared state is implemented. Separate users can run different session IDs, but no load/capacity claim has been established.

HTTPS is necessary for microphone access away from localhost. A tester must grant microphone access deliberately; typed input remains available. Current voice capabilities can be queried at `/healthz`, but its flags reflect provider selection, not a live credential check.

A LAN address alone is not a complete voice-sharing setup: loopback backend binding, browser API URLs, origin checks and microphone secure-context requirements all need attention. No public exposure was enabled during the documentation/benchmark pass.

## State and database audit

| Component | Implementation | Implication |
| --- | --- | --- |
| SessionStore | `services/orchestrator/src/session-store.ts`: `Map<string, ModelMessage[]>` and active `Set` | Atomic successful-turn history commit; per-process mutual exclusion only |
| Activity bus | `services/orchestrator/src/bus.ts`: map of buffers/listeners | Replays last 500 events/session; empty listener sets and session buffers are not expired |
| Agency store | `services/mcp-agency/src/store.ts`: seeded arrays | Shared customers/bookings; tickets and audit appended in RAM; no durable transaction/audit trail |
| Frontend | React state and refs in `apps/web/src/lib/session.ts` | No localStorage/database persistence; reload creates a new random session |

There are no SQL drivers, schemas, migrations, database containers or connection pools. `DATABASE_URL` and `REDIS_URL` are not read. There is no SQLite fallback. The mock store is application data, not a database cache.

No TTL, history truncation, token-based context trimming, global session cap or distributed lock is present. Memory can grow with new sessions/history. Restarting the orchestrator clears conversation/activity history; restarting the agency resets mock mutations. Tool mutations are not rolled back if a later model step fails.

## Cache audit

- MCP **tool definitions** are discovered and retained once at startup in `mcp.ts`. Readiness only checks that all three toolsets were registered; it does not continuously recheck provider health.
- Weather/geocoding fetches have eight-second request deadlines but no application cache. The climate table and NPS guides are static data, not response caching.
- Travel mocks are seeded/deterministic for relevant inputs, not cached provider results.
- Airbnb links mode makes no Airbnb provider call. Opt-in live mode has a 20-second child lifetime and two concurrent children per process; it does not introduce a result cache.
- There is no application LLM-response cache. Stable system prompts are assembled before volatile content, but no explicit Anthropic cache policy, usage capture or hit-rate counter is configured. Provider-side behavior cannot be inferred from response time.
- Next.js asset/page caching is separate from the planning API; it does not cache trip research.

## Recommended next engineering steps (not implemented)

Start small: **one app/backend deployment, Postgres for durable records, and access control**. A SQL conversation table keyed by authenticated user/session would be sufficient initially; Redis is not required merely to persist chat.

If multiple backend replicas or higher traffic are needed, add shared conversation/event storage and a distributed turn lock with expiry. Redis could also hold short-lived weather/geocoding results and rate-limit counters. Cache keys must include normalized destination, date range, provider and relevant party/filter parameters. Do not share private conversation answers between users. Never treat cached availability/prices as bookable without revalidation.

Suggested starting policies to evaluate: idle-session retention measured in hours, bounded history by token budget, weather cache in minutes, geocoding cache in days, and uncached booking mutations. These are proposed policies, not existing settings.

Add measurements before tuning: model input/output/cache tokens, each model step, MCP call latency/error rate, STT latency, TTS first chunk and browser first audible playback. That will distinguish routing, research, synthesis, network and audio costs. Streaming partial speech or text requires a pipeline change; changing a timeout does not reduce model work.

## Local checks and failures

- All backends expose `/healthz` and `/readyz`. The web app is checked at `/`.
- Start MCP services before the orchestrator, which discovers all tools before listening.
- Port-in-use errors: stop an earlier stack before restarting. The development launcher assigns 8101/8102/8103/8080/3000 explicitly.
- If model requests fail, verify configured model access and credentials locally; do not paste secrets into issues.
- Run `pnpm build` before launching a fresh checkout so workspace packages have compiled exports.
- Stop the Next development process before running a production build, then restart it; both use `.next`.
- Speech providers are explicitly selected, with no automatic failover. STT is prerecorded; TTS is optional and playback currently starts after the entire utterance arrives.
