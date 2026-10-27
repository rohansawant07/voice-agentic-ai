# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN npm install --global pnpm@11.22.0
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=cache,id=roam-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
# A single image works behind any same-origin gateway; no localhost API baked in.
ENV NEXT_PUBLIC_ORCH_URL="" NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM build AS service-package
ARG SERVICE=orchestrator
RUN pnpm --filter @concierge/${SERVICE} deploy --legacy --prod /out

FROM node:22-bookworm-slim AS service
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=service-package --chown=node:node /out/ ./
USER node
CMD ["node", "dist/index.js"]

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /app/apps/web/.next/static/ ./apps/web/.next/static/
USER node
CMD ["node", "apps/web/server.js"]
