# Roam project handoff

Updated October 27, 2026. This file is durable repository context, not a claim of global assistant memory. Read it alongside README.md, ARCHITECTURE.md and deploy/README.md when resuming work.

## Current state

- Product name: Roam. Public source repository: https://github.com/rohansawant07/voice-agentic-ai.
- Working directory on the current laptop: `/Users/rohansawant/Downloads/voice_agentic_ai`.
- Protected Docker pilot: http://localhost:3080, seven services, PostgreSQL-backed conversations/events and shared locks. Direct development remains on port 3000 with memory state unless DATABASE_URL is configured.
- Local login is in ignored `.secrets/tester-login.txt`; provider credentials remain in ignored `.env`. Never copy credentials into documentation or Git.
- October 26 checks: all seven containers healthy; anonymous HTTP 401, authenticated UI 200, API validation 400; database persistence and authenticated WebSocket replay verified. User subsequently confirmed the site works. Embedded-browser Basic-auth prompts may fail; use Chrome or Safari.
- Docker implementation commit: `67aea1b`. Fourteen tests including authentication and PostgreSQL integration; database test requires TEST_DATABASE_URL. See execution history for validation details.
- Deepgram handles transcription. Optional spoken replies require a separate configured TTS provider. Airbnb uses direct search links, not verified listings. Travel/agency inventory is demo data; agency mutations are disabled in Compose.
- No Redis or application response cache. No production latency/capacity claim; existing measurements are small-sample local benchmarks in docs/PERFORMANCE.md.

## AWS constraints and next step

- Region: us-east-1. Budget: close to zero. No owned domain.
- User explicitly requested preparation without paid resources while Free Tier/credits are unknown. No AWS resources were created; no public hosted application exists.
- Next: user signs into the intended AWS account, checks plan/credit eligibility and expiry, then agrees to a concrete deployment budget before resource creation.
- `deploy/aws/host.cloudformation.yaml` is an unexecuted host-only scaffold, not a complete public deployment. Review deploy/aws/README.md before proceeding.
- Preserve the local database volume. Do not use `docker compose down -v` on saved user data.

## Remaining work

AWS access and cost verification, HTTPS hosting, proper multi-user identity/quotas, backups and restore validation, replica/load testing, observability and token-cost metrics. Card selection is visual only; no real bookings or payments are implemented.
