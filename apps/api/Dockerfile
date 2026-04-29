# apps/api/Dockerfile
# Multi-stage build for the NestJS API.
# Build context: repo root (so shared packages are accessible).
#
# Stages:
#   base    — Node + pnpm setup
#   deps    — install all workspace deps
#   builder — compile TypeScript → dist/
#   runner  — minimal production image

ARG NODE_VERSION=22
ARG PNPM_VERSION=9.12.0

# ── base ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
# Copy workspace manifests only (for cache efficiency)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/
# Install with frozen lockfile; cache the pnpm store
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @myclash/api... --filter @myclash/types

# ── builder ───────────────────────────────────────────────────────────────────
FROM deps AS builder
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
# Copy source
COPY tsconfig.base.json ./
COPY apps/api/ ./apps/api/
COPY packages/types/ ./packages/types/
# Build shared packages first, then the API
RUN pnpm --filter @myclash/types build
RUN pnpm --filter @myclash/api build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nestjs

# Copy only what's needed to run
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./package.json
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages/types/dist ./node_modules/@myclash/types/dist

USER nestjs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
