#!/usr/bin/env bash
# Run the full M1 stack locally: 3 MCP servers + orchestrator.
# Requires ANTHROPIC_API_KEY in the environment or in .env at repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && set -a && source .env && set +a

trap 'kill 0' EXIT
(cd services/mcp-travel  && pnpm dev) &
(cd services/mcp-weather && pnpm dev) &
(cd services/mcp-agency  && pnpm dev) &
sleep 2
(cd services/orchestrator && pnpm dev) &
wait
