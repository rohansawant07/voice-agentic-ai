#!/usr/bin/env bash
# Run the full stack locally: 3 MCP servers + orchestrator + web UI (:3000).
# Requires ANTHROPIC_API_KEY in the environment or in .env at repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && set -a && source .env && set +a

trap 'kill 0' EXIT
(cd services/mcp-travel  && PORT=8101 pnpm dev) &
(cd services/mcp-weather && PORT=8102 pnpm dev) &
(cd services/mcp-agency  && PORT=8103 pnpm dev) &
sleep 2
(cd services/orchestrator && PORT=8080 pnpm dev) &
(cd apps/web && PORT=3000 pnpm dev) &
wait
