# syntax=docker/dockerfile:1
#
# One image serves both entrypoints: `node dist/main.js` (API) and `node dist/worker.js`
# (pipeline). They share a codebase, so shipping one image keeps them provably in step —
# a worker running older matching rules than the API is a class of bug worth designing out.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ── dependencies ──────────────────────────────────────────────────────────────
# Copied before the sources so a code change does not invalidate the install layer.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/validation/package.json packages/validation/
COPY packages/ai/package.json packages/ai/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter '!@jobsentinel/web...'

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter '@jobsentinel/types' --filter '@jobsentinel/config' \
         --filter '@jobsentinel/validation' --filter '@jobsentinel/ai' build \
 && pnpm --filter '@jobsentinel/api' build

# Drop dev dependencies from what we carry into the runtime image.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter '!@jobsentinel/web...'

# ── runtime ───────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
# Unprivileged: nothing here needs root, and the image reaches the public internet.
USER node
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/

WORKDIR /app/apps/api
EXPOSE 4000

# Readiness, not liveness: /health/ready also checks the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
