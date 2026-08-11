# apps/web-marketing/Dockerfile
#
# Static marketing site: Astro prerenders to plain HTML, Caddy serves it.
# Build context: repo root (the pnpm workspace root holds the lockfile).
#
# There is no server at runtime. The final stage is the same `caddy:2-alpine`
# it always was — the node stages exist only to turn src/ into dist/ and are
# discarded. `scripts/check-infra-review.mjs` asserts `FROM caddy:` appears
# here, and it still does.

ARG NODE_VERSION=26
ARG PNPM_VERSION=11.20.0

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps
ARG PNPM_VERSION
RUN npm install -g corepack && corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web-marketing/package.json ./apps/web-marketing/
# No `--filter` chain of workspace packages: this app deliberately depends on
# nothing from packages/. It is a leaf, and keeping it one is what lets the
# image stay this small.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @myclash/web-marketing

# ── builder ──────────────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY apps/web-marketing/ ./apps/web-marketing/
RUN pnpm --filter @myclash/web-marketing build

# ── runner ───────────────────────────────────────────────────────────────────
FROM caddy:2-alpine AS runner

COPY --from=builder /app/apps/web-marketing/dist/ /usr/share/caddy/

# The Caddyfile is a real file rather than a printf one-liner: the routing rules
# it carries are subtle enough to need comments, and a one-liner cannot hold
# them. See apps/web-marketing/Caddyfile for why the try_files order matters.
COPY apps/web-marketing/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80

# infra/docker-compose.prod.yml declares its own `healthcheck:` for this
# service, which wins. This one covers the dev compose file, which does not —
# and `healthcheckOwner()` in scripts/check-infra-review.mjs reads it from here
# when compose stays quiet.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ > /dev/null || exit 1
