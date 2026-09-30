# syntax=docker/dockerfile:1.7

# One build for the whole workspace, then a small runtime image per service.
# docker compose builds each target from the same cached build stage.

ARG NODE_IMAGE=node:24.21.0-trixie-slim

FROM ${NODE_IMAGE} AS base
ENV CI=true \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.8.1 && npm cache clean --force
WORKDIR /repo

FROM base AS build
# Download every package named in the lockfile before copying the source,
# so dependency layers stay cached while code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store
RUN pnpm turbo run build
# Self-contained production bundles for the Node services: their own
# code, the workspace packages they use, and production dependencies only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @dsd/api deploy --prod --store-dir /pnpm/store /out/api && \
    pnpm --filter @dsd/worker deploy --prod --store-dir /pnpm/store /out/worker

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
CMD ["node", "dist/main.js"]

# Next.js standalone output: a minimal server plus only the files it uses.
FROM runtime AS customer-web
ENV HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /repo/apps/customer-web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/customer-web/.next/static ./apps/customer-web/.next/static
EXPOSE 3000
CMD ["node", "apps/customer-web/server.js"]

FROM runtime AS agent-web
ENV HOSTNAME=0.0.0.0 PORT=3001
COPY --from=build --chown=node:node /repo/apps/agent-web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/agent-web/.next/static ./apps/agent-web/.next/static
EXPOSE 3001
CMD ["node", "apps/agent-web/server.js"]
