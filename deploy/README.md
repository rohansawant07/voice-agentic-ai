# Roam containers

The local Compose deployment is a protected pilot. It creates **no AWS resources**. Keep Docker Desktop running while using it.

## Start

```bash
# First run only. Creates ignored, private files under .secrets/.
node scripts/setup-containers.mjs

# .env supplies your provider keys. .secrets/compose.env supplies database/gateway
# credentials and the container preview origin. It overrides the local-dev origin.
docker compose --env-file .env --env-file .secrets/compose.env up -d --build --wait
```

Open **http://localhost:3080**. The browser asks for a username/password. Read `.secrets/tester-login.txt` locally; do not commit it, paste it into an issue, or include it in a URL. Anonymous requests return 401. Basic authentication is appropriate only on loopback or behind HTTPS, never plain public HTTP. The default gateway binds **127.0.0.1 only**; it is not externally shared.

The existing non-container development app can continue on port 3000. This avoids disrupting it. Docker Desktop should show the `roam` project and seven healthy containers: gateway, web, orchestrator, travel, weather, agency and postgres.

The login/password and Compose environment files are mode 0600 inside a mode-0700 directory. The password-hash file is readable by the nginx worker inside its container; it contains no plaintext password. The setup script refuses to overwrite existing credentials. To rotate them, stop the stack and follow a deliberate database-password and gateway-password rotation; do not just delete `.secrets` while retaining the database volume.

## Day-to-day commands

Use the same environment files for each command:

```bash
docker compose --env-file .env --env-file .secrets/compose.env ps
docker compose --env-file .env --env-file .secrets/compose.env logs --tail 100 orchestrator
docker compose --env-file .env --env-file .secrets/compose.env stop
docker compose --env-file .env --env-file .secrets/compose.env start

# Remove containers/network while preserving the named PostgreSQL volume:
docker compose --env-file .env --env-file .secrets/compose.env down

# Integration tests against the real local PostgreSQL container:
docker compose --env-file .env --env-file .secrets/compose.env --profile testing run --build --rm tests
```

**Do not use `down -v` on data you want to keep.** That deletes the database volume. CI uses it only for its own disposable stack. No automatic backup service is installed.

## What's in the images

- A multi-stage root Dockerfile compiles TypeScript and the Next.js production app.
- Backend runtimes use pnpm's production deployment output. Development dependencies are not shipped in those service images.
- Next.js uses standalone output and same-origin API/WebSocket URLs. No localhost API address or provider key is built into browser assets.
- App containers run as the Node user, drop Linux capabilities, use resource/log limits and process initialization, and restart unless stopped.
- PostgreSQL and nginx use their standard image entrypoints; they are not claimed rootless.
- `.dockerignore` excludes local credentials, environment files, Git state and host build artifacts. Runtime secrets are injected into the orchestrator, not copied into images or MCP services.
- App image bases are version-family tags, not immutable digest pins. Pin tested digests before a release; add vulnerability scanning before public launch.

## State and concurrency

With `DATABASE_URL`, the orchestrator stores successful user/assistant pairs in PostgreSQL. Each session retains its most recent 24 messages and expires after 24 hours of inactivity. Cleanup runs every minute. PostgreSQL advisory locks prevent overlapping turns for the same session across instances. Four model turns are admitted globally per database; extra turns return HTTP 429 (voice returns an error).

Activity events also live in PostgreSQL, with up to 500 events per session and 24-hour retention. WebSocket connections poll every 500 ms. This is a shared, durable pilot event log, not a high-volume streaming platform. Cross-instance replay and lock behavior are integration-tested. Browser refresh still creates a new session; a saved-trip/account UI is not implemented.

Gateway identities namespace session IDs. Two distinct gateway users cannot read or continue each other's guessed session IDs. The initial setup creates one `tester` identity; sharing that login shares its identity boundary. Use a separate credential per tester, or replace Basic auth with an identity provider for a larger deployment.

Startup applies the idempotent initial schema under a migration lock. Versioned upgrade/rollback tooling beyond migration 001 is not implemented. Database startup readiness checks are real queries. MCP readiness still reflects startup discovery, not ongoing provider availability.

## Limits and safety boundaries

The gateway applies HTTP chat/connection rate limits. Chat bodies are limited; voice frames/utterances are bounded, overlapping transcription is rejected, and voice input is throttled per connection. Provider request/model deadlines are configured. These controls are not billing caps and do not replace provider spend controls.

Agency bookings/customers are still seeded demo data. Container configuration disables cancellation, modification and ticket creation instead of pretending those arrays are shared production records. Airbnb is direct-link mode. No real booking/payment system exists.

A single Docker host and one database are not highly available. The shared state removes specific in-memory scaling blockers, but replicas, rolling deploys, restored backups and sustained load still need validation. A 500 ms poll per connected browser is an explicit pilot tradeoff. Redis is not required or configured.

## Backups

A named Docker volume survives container replacement, not disk failure. Before upgrading, create a PostgreSQL dump and save it outside the host; protect it as conversation data. Test restoring into a separate database. For an AWS pilot, encrypted disk snapshots or database backups must be configured before depending on persistence. Retention/ownership policies must be reviewed before storing real customer information.

## AWS

See [AWS preparation](aws/README.md). Region: us-east-1. No AWS deployment or paid resource creation is authorized until account eligibility and a budget are confirmed. The host template is only a scaffold, not a public app deployment. Docker operations on this laptop do not create AWS charges; live model or speech requests can still use provider credits.
