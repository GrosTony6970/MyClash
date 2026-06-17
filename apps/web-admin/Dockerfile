# apps/web-admin/Dockerfile
# Multi-stage build for the organizer admin + super admin Next.js app.
# Build context: repo root. Requires next.config.ts output: 'standalone'.

ARG NODE_VERSION=26
ARG PNPM_VERSION=10.27.0

FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN npm install -g corepack && corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web-admin/package.json ./apps/web-admin/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/design-tokens/package.json ./packages/design-tokens/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/rulesets/package.json ./packages/rulesets/
COPY packages/time/package.json ./packages/time/
COPY packages/feature-flags/package.json ./packages/feature-flags/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @myclash/web-admin \
      --filter @myclash/types \
      --filter @myclash/ui \
      --filter @myclash/design-tokens \
      --filter @myclash/i18n \
      --filter @myclash/api-client \
      --filter @myclash/rulesets \
      --filter @myclash/time \
      --filter @myclash/feature-flags

FROM deps AS builder
ARG GIT_COMMIT=unknown
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SCORING_URL
ARG NEXT_PUBLIC_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SENTRY_DSN_ADMIN
ARG SENTRY_ENVIRONMENT=production
ARG SENTRY_RELEASE
ARG SENTRY_TRACES_SAMPLE_RATE=0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SENTRY_DSN_ADMIN=${NEXT_PUBLIC_SENTRY_DSN_ADMIN}
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${SENTRY_ENVIRONMENT}
ENV NEXT_PUBLIC_SENTRY_RELEASE=${SENTRY_RELEASE}
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=${SENTRY_TRACES_SAMPLE_RATE}
ENV SENTRY_ENVIRONMENT=${SENTRY_ENVIRONMENT}
ENV SENTRY_RELEASE=${SENTRY_RELEASE}
ENV SENTRY_TRACES_SAMPLE_RATE=${SENTRY_TRACES_SAMPLE_RATE}

COPY tsconfig.base.json ./
COPY eslint.config.mjs ./
COPY eslint-rules/ ./eslint-rules/
COPY apps/web-admin/ ./apps/web-admin/
COPY packages/types/ ./packages/types/
COPY packages/ui/ ./packages/ui/
COPY packages/design-tokens/ ./packages/design-tokens/
COPY packages/i18n/ ./packages/i18n/
COPY packages/api-client/ ./packages/api-client/
COPY packages/rulesets/ ./packages/rulesets/
COPY packages/time/ ./packages/time/
COPY packages/feature-flags/ ./packages/feature-flags/

RUN pnpm --filter @myclash/types build \
 && pnpm --filter @myclash/design-tokens build \
 && pnpm --filter @myclash/i18n build \
 && pnpm --filter @myclash/api-client build \
 && pnpm --filter @myclash/rulesets build \
 && pnpm --filter @myclash/time build \
 && pnpm --filter @myclash/feature-flags build \
 && pnpm --filter @myclash/ui build \
 && pnpm --filter @myclash/web-admin build

FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web-admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-admin/.next/static     ./apps/web-admin/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-admin/public           ./apps/web-admin/public
# Lock file lets Trivy resolve exact installed versions from pnpm overrides
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml                  ./pnpm-lock.yaml

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web-admin/server.js"]
