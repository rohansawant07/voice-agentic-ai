# Roam project handoff

Updated October 27, 2026 (trip board redesign, AWS kit). This file is durable repository context, not a claim of global assistant memory. Read it alongside README.md, ARCHITECTURE.md and deploy/README.md when resuming work.

## Current state

- Product name: Roam. Public source repository: https://github.com/rohansawant07/voice-agentic-ai.
- Working directory on the current laptop: `/Users/rohansawant/Downloads/voice_agentic_ai`.
- Protected Docker pilot: http://localhost:3080, seven services, PostgreSQL-backed conversations/events and shared locks. Direct development remains on port 3000 with memory state unless DATABASE_URL is configured.
- Local login is in ignored `.secrets/tester-login.txt`; provider credentials remain in ignored `.env`. Never copy credentials into documentation or Git.
- October 26 checks: all seven containers healthy; anonymous HTTP 401, authenticated UI 200, API validation 400; database persistence and authenticated WebSocket replay verified. User subsequently confirmed the site works. Embedded-browser Basic-auth prompts may fail; use Chrome or Safari.
- Docker implementation commit: `67aea1b`. Fourteen tests including authentication and PostgreSQL integration; database test requires TEST_DATABASE_URL. See execution history for validation details.
- Itinerary guides: curated NPS for Harpers Ferry/Shenandoah, live Wikivoyage listings elsewhere (DESTINATION_GUIDES). Closed-season listings are filtered in code. Wording embellishment and retitling are measured by `scripts/eval-itinerary.mjs` (paid, offline; 0/4 grounded on October 27, see docs/evals/README.md).
- Deepgram handles transcription. Optional spoken replies require a separate configured TTS provider. Airbnb uses direct search links, not verified listings. Travel/agency inventory is demo data; agency mutations are disabled in Compose.
- No Redis or application response cache. No production latency/capacity claim; existing measurements are small-sample local benchmarks in docs/PERFORMANCE.md.

## AWS constraints and next step

- Region: us-east-1. Budget: close to zero. No owned domain. User asked on October 27 to deploy; no AWS CLI or credentials existed on the laptop, so no resources were created yet.
- Ready kit: `deploy/aws/deploy.sh up` (requires AWS CLI v2 signed in). It confirms cost (about $21/month: t3.small, Elastic IP, 20 GiB gp3, snapshots), uploads `.env` keys to SSM `/roam/*`, deploys `roam.cloudformation.yaml`, and serves `https://<ip-dashed>.sslip.io` via Caddy. The login is saved to `.secrets/aws-tester-login.txt`.
- Verified locally only (overlay under project `roam-awstest`). Still unverified in a real account: Let's Encrypt issuance for sslip.io, first-boot build time, snapshot restore.
- `update` rebuilds from GitHub, so push first. The data volume is retained on `down`. Never rotate `/roam/postgres-password` alone.
- Preserve the local database volume `roam_pgdata`. Do not use `docker compose down -v` on saved user data; use a separate `-p` project for experiments.

## Remaining work

First AWS deploy and sslip.io certificate check, proper multi-user identity/quotas, backups and restore validation, replica/load testing, observability and token-cost metrics. Card picks drive a local estimated total but do not inform the orchestrator; no real bookings or payments are implemented.

## Web research update

All seven agents now have Anthropic-backed search_web using the existing key. See README.md for budgets/configuration and citation display. Live NPS search verified; deterministic failure/budget tests added. This adds provider usage and does not replace mock inventory with live booking APIs.

## README audit

October 27: refreshed all four project-owned READMEs, including eval evidence and AWS search configuration limitations. Anthropic web search is live-tested; local login checks passed, but the embedded browser may fail to display Basic auth. Latest committed itinerary eval remains 0/4 passing; tool connectivity is not proof of grounded itinerary output. Imported skill README files remain upstream references and are not rewritten.
