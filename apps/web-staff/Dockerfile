# apps/web-staff/Dockerfile
# Multi-stage build for the scorekeeper Next.js PWA (offline-first).
# Build context: repo root. Requires next.config.ts output: 'standalone'.

ARG NODE_VERSION=26
ARG PNPM_VERSION=11.20.0

FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN npm install -g corepack && corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web-staff/package.json ./apps/web-staff/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/feature-flags/package.json ./packages/feature-flags/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @myclash/web-staff \
      --filter @myclash/types \
      --filter @myclash/ui \
      --filter @myclash/i18n \
      --filter @myclash/api-client \
      --filter @myclash/feature-flags

FROM deps AS builder
# Silence DEP0205 (module.register) from import-in-the-middle via Sentry/OTel
# on Node 26 — harmless upstream deprecation. Disables only this warning.
ENV NODE_OPTIONS=--disable-warning=DEP0205
# No GIT_COMMIT / release SHA in this stage, on purpose. BuildKit folds build
# args and env into the cache key of every RUN, so a per-commit value here
# invalidated the whole `next build` on every deploy while the COPY layers below
# stayed CACHED — the image was rebuilt from scratch even when nothing in it had
# changed. The commit still reaches the container: docker-compose.prod.yml sets
# GIT_COMMIT in this service's runtime `environment:` block.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SENTRY_DSN_SCORING
ARG SENTRY_ENVIRONMENT=production
# Names the release the uploaded source maps belong to. Compose no longer passes
# it (see the GIT_COMMIT note above) — it is empty for every build, which is what
# keeps this stage cacheable. It stays declared because it is the knob to turn
# the day SENTRY_AUTH_TOKEN is supplied: pass both together and accept that the
# release value rebuilds the image, since the maps have to match that build.
ARG SENTRY_RELEASE
ARG SENTRY_TRACES_SAMPLE_RATE=0
# Source-map upload token (build-time ONLY). Deliberately NOT set in the runner
# stage or any runtime `environment:` block — it must never ship in the final
# image or reach the browser. Empty in dev ⇒ the Sentry plugin skips upload and
# the build stays green.
ARG SENTRY_AUTH_TOKEN
# Asset prefix mirrors the Traefik /scoring sub-path mount on both
# admin.${DOMAIN} and staff.${DOMAIN}. Must persist into the
# `next build` invocation so next.config.ts picks it up.
ARG STAFF_ASSET_PREFIX
ENV STAFF_ASSET_PREFIX=${STAFF_ASSET_PREFIX}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SENTRY_DSN_SCORING=${NEXT_PUBLIC_SENTRY_DSN_SCORING}
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${SENTRY_ENVIRONMENT}
# NEXT_PUBLIC_SENTRY_RELEASE is NOT set here. Next inlines NEXT_PUBLIC_* into the
# browser bundle at build time, so baking the commit SHA made the bundle — and
# therefore this whole image — differ on every commit. Browser events lose their
# release tag; server-side events keep it (runtime env). Nothing else is lost
# today: no source maps are uploaded, so there was nothing for that tag to
# resolve against. See apps/web-staff/instrumentation-client.ts.
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=${SENTRY_TRACES_SAMPLE_RATE}
ENV SENTRY_ENVIRONMENT=${SENTRY_ENVIRONMENT}
ENV SENTRY_RELEASE=${SENTRY_RELEASE}
ENV SENTRY_TRACES_SAMPLE_RATE=${SENTRY_TRACES_SAMPLE_RATE}
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}

COPY tsconfig.base.json tsconfig.lib.json ./
COPY eslint.config.mjs ./
COPY eslint-rules/ ./eslint-rules/
COPY apps/web-staff/ ./apps/web-staff/
COPY packages/types/ ./packages/types/
COPY packages/ui/ ./packages/ui/
COPY packages/i18n/ ./packages/i18n/
COPY packages/api-client/ ./packages/api-client/
COPY packages/feature-flags/ ./packages/feature-flags/

# feature-flags is built before ui because @myclash/ui imports types from it
# (MaintenanceBanner + useRuntimeFlags consume PublicFeatureFlagsSnapshot).
RUN pnpm --filter @myclash/types build \
 && pnpm --filter @myclash/i18n build \
 && pnpm --filter @myclash/api-client build \
 && pnpm --filter @myclash/feature-flags build \
 && pnpm --filter @myclash/ui build \
 && pnpm --filter @myclash/web-staff build

FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Silence DEP0205 (module.register) from import-in-the-middle via Sentry/OTel
# on Node 26 — harmless upstream deprecation. Disables only this warning.
ENV NODE_OPTIONS=--disable-warning=DEP0205
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web-staff/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-staff/.next/static     ./apps/web-staff/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-staff/public           ./apps/web-staff/public
# Lock file lets Trivy resolve exact installed versions from pnpm overrides
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml                  ./pnpm-lock.yaml

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>{if(r.statusCode!==200)console.error('HTTP '+r.statusCode);process.exit(r.statusCode===200?0:1)}).on('error',e=>{console.error(e.code||e.name,e.message);process.exit(1)})"

CMD ["node", "apps/web-staff/server.js"]
