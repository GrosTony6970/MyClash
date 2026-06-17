# apps/web-public/Dockerfile
# Multi-stage build for the public/spectator/competitor Next.js PWA.
# Build context: repo root (so shared packages are accessible).
# Requires next.config.ts to have output: 'standalone'.

ARG NODE_VERSION=26
ARG PNPM_VERSION=10.27.0

# ── base ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN npm install -g corepack && corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web-public/package.json ./apps/web-public/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/design-tokens/package.json ./packages/design-tokens/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/time/package.json ./packages/time/
COPY packages/feature-flags/package.json ./packages/feature-flags/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @myclash/web-public \
      --filter @myclash/types \
      --filter @myclash/ui \
      --filter @myclash/design-tokens \
      --filter @myclash/i18n \
      --filter @myclash/api-client \
      --filter @myclash/time \
      --filter @myclash/feature-flags

# ── builder ───────────────────────────────────────────────────────────────────
FROM deps AS builder
ARG GIT_COMMIT=unknown
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SENTRY_DSN_PUBLIC
ARG SENTRY_ENVIRONMENT=production
ARG SENTRY_RELEASE
ARG SENTRY_TRACES_SAMPLE_RATE=0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SENTRY_DSN_PUBLIC=${NEXT_PUBLIC_SENTRY_DSN_PUBLIC}
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${SENTRY_ENVIRONMENT}
ENV NEXT_PUBLIC_SENTRY_RELEASE=${SENTRY_RELEASE}
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=${SENTRY_TRACES_SAMPLE_RATE}
ENV SENTRY_ENVIRONMENT=${SENTRY_ENVIRONMENT}
ENV SENTRY_RELEASE=${SENTRY_RELEASE}
ENV SENTRY_TRACES_SAMPLE_RATE=${SENTRY_TRACES_SAMPLE_RATE}

COPY tsconfig.base.json ./
COPY eslint.config.mjs ./
COPY eslint-rules/ ./eslint-rules/
COPY apps/web-public/ ./apps/web-public/
COPY packages/types/ ./packages/types/
COPY packages/ui/ ./packages/ui/
COPY packages/design-tokens/ ./packages/design-tokens/
COPY packages/i18n/ ./packages/i18n/
COPY packages/api-client/ ./packages/api-client/
COPY packages/time/ ./packages/time/
COPY packages/feature-flags/ ./packages/feature-flags/

# Build shared packages first, then the app.
# feature-flags is built before ui because @myclash/ui imports types from it
# (MaintenanceBanner + useRuntimeFlags consume PublicFeatureFlagsSnapshot).
RUN pnpm --filter @myclash/types build \
 && pnpm --filter @myclash/design-tokens build \
 && pnpm --filter @myclash/i18n build \
 && pnpm --filter @myclash/api-client build \
 && pnpm --filter @myclash/time build \
 && pnpm --filter @myclash/feature-flags build \
 && pnpm --filter @myclash/ui build \
 && pnpm --filter @myclash/web-public build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Next.js standalone output bundles everything needed
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-public/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-public/.next/static     ./apps/web-public/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-public/public           ./apps/web-public/public
# Lock file lets Trivy resolve exact installed versions from pnpm overrides
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml                  ./pnpm-lock.yaml

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web-public/server.js"]
