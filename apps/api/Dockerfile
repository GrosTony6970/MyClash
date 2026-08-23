# apps/api/Dockerfile
# Multi-stage build for the NestJS API.
# Build context: repo root (so shared packages are accessible).
#
# Stages:
#   base    — Node + pnpm setup
#   deps    — install all workspace deps
#   builder — compile TypeScript → dist/
#   runner  — minimal production image

ARG NODE_VERSION=26
ARG PNPM_VERSION=11.20.0

# ── base ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN npm install -g corepack && corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
# Copy workspace manifests only (for cache efficiency)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/rules/package.json ./packages/rules/
COPY packages/types/package.json ./packages/types/
COPY packages/rulesets/package.json ./packages/rulesets/
COPY packages/time/package.json ./packages/time/
COPY packages/feature-flags/package.json ./packages/feature-flags/
COPY packages/db/package.json ./packages/db/
# Install with frozen lockfile; cache the pnpm store
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @myclash/api... --filter @myclash/rules --filter @myclash/types --filter @myclash/rulesets --filter @myclash/time --filter @myclash/feature-flags --filter @myclash/db

# ── builder ───────────────────────────────────────────────────────────────────
FROM deps AS builder
# GIT_COMMIT is deliberately ABSENT from this stage. Nothing here reads it —
# its three readers (version.service.ts, system-versions.service.ts,
# common/observability/sentry.ts) all run at RUNTIME and take it from the
# `environment:` block of infra/docker-compose.prod.yml.
#
# Declaring it here was not free: BuildKit folds build args and env into the
# cache key of every RUN in the stage, so a new commit SHA invalidated the whole
# compile while the COPY layers below stayed CACHED (content-addressed). Every
# deploy therefore rebuilt this image from scratch, changed or not. Re-adding an
# ARG here re-buys that cost for the entire image.
# Copy source
COPY tsconfig.base.json tsconfig.lib.json ./
COPY apps/api/ ./apps/api/
COPY packages/rules/ ./packages/rules/
COPY packages/types/ ./packages/types/
COPY packages/rulesets/ ./packages/rulesets/
COPY packages/time/ ./packages/time/
COPY packages/feature-flags/ ./packages/feature-flags/
# Build shared packages first, then the API
RUN pnpm --filter @myclash/rules build
RUN pnpm --filter @myclash/types build
RUN pnpm --filter @myclash/rulesets build
RUN pnpm --filter @myclash/time build
RUN pnpm --filter @myclash/feature-flags build
RUN pnpm --filter @myclash/api build

# Runtime dependencies only. This avoids shipping pnpm, Vite, Vitest, esbuild,
# and other build/test tooling in the final production image.
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/rules/package.json ./packages/rules/
COPY packages/types/package.json ./packages/types/
COPY packages/rulesets/package.json ./packages/rulesets/
COPY packages/time/package.json ./packages/time/
COPY packages/feature-flags/package.json ./packages/feature-flags/
COPY packages/db/package.json ./packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts --filter @myclash/api... --filter @myclash/rules --filter @myclash/types --filter @myclash/rulesets --filter @myclash/time --filter @myclash/feature-flags --filter @myclash/db

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner

# Silence DEP0205 (module.register) from import-in-the-middle via Sentry/OTel
# on Node 26 — harmless upstream deprecation. Disables only this warning.
# (Build stage is tsc, so only the runtime needs it.)
ENV NODE_OPTIONS=--disable-warning=DEP0205

WORKDIR /app

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nestjs

# Copy only what's needed to run
COPY --from=prod-deps --chown=nestjs:nodejs /app/package.json ./package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/apps/api/package.json ./apps/api/package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/apps/api/node_modules ./apps/api/node_modules
# EVERY package with a dependency needs its node_modules here, because that is
# where pnpm puts the link — including a link to another WORKSPACE package.
# `packages/rules` and `packages/feature-flags` are the only two that declare
# none, so they are the only two with no node_modules COPY.
#
# `packages/types` was missed, and it took the api and the worker down on the
# first deploy after `@myclash/types` gained a runtime dependency on
# `@myclash/rules`. Both crash-looped on
# `Cannot find module '@myclash/rules'` from `packages/types/dist/match-clock.js`.
# Nothing caught it earlier: the image BUILDS fine (the builder stage has the
# full workspace), and a missing runtime link only shows when a container
# actually starts.
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/rules/package.json ./packages/rules/package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/types/package.json ./packages/types/package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/rulesets/package.json ./packages/rulesets/package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/rulesets/node_modules ./packages/rulesets/node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/time/package.json ./packages/time/package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/time/node_modules ./packages/time/node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/feature-flags/package.json ./packages/feature-flags/package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/db/package.json ./packages/db/package.json
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/rules/dist ./packages/rules/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/types/dist ./packages/types/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/rulesets/dist ./packages/rulesets/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/time/dist ./packages/time/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/feature-flags/dist ./packages/feature-flags/dist
COPY --chown=nestjs:nodejs VERSION ./VERSION
COPY --chown=nestjs:nodejs infra/docker-compose.prod.yml ./infra/docker-compose.prod.yml
COPY --chown=nestjs:nodejs apps/web-admin/package.json ./apps/web-admin/package.json
COPY --chown=nestjs:nodejs apps/web-public/package.json ./apps/web-public/package.json
COPY --chown=nestjs:nodejs apps/web-staff/package.json ./apps/web-staff/package.json
COPY --chown=nestjs:nodejs apps/web-marketing/package.json ./apps/web-marketing/package.json
RUN ln -s apps/api/dist dist \
 && chown -h nestjs:nodejs dist
# Bootstrap scripts (run as one-off containers during deploy)
COPY --chown=nestjs:nodejs scripts/bootstrap-super-admin.mjs ./scripts/bootstrap-super-admin.mjs
COPY --chown=nestjs:nodejs scripts/create-demo-org.mjs ./scripts/create-demo-org.mjs
# Migration script + SQL files. Plain `postgres` applying raw SQL in filename
# order, checksummed — no ORM and no migration framework of any kind.
COPY --chown=nestjs:nodejs packages/db/scripts/migrate.mjs ./packages/db/scripts/migrate.mjs
COPY --chown=nestjs:nodejs packages/db/migrations/ ./packages/db/migrations/

USER nestjs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health',r=>{if(r.statusCode!==200)console.error('HTTP '+r.statusCode);process.exit(r.statusCode===200?0:1)}).on('error',e=>{console.error(e.code||e.name,e.message);process.exit(1)})"

CMD ["node", "dist/main.js"]
