# apps/web-marketing/Dockerfile
#
# Minimal static site served by Caddy.
# The marketing site is plain HTML/CSS — no build step needed.

FROM caddy:2-alpine

# Copy static files
COPY public/ /usr/share/caddy/

# The Caddyfile is a real file rather than a printf one-liner: the routing rules
# it carries are subtle enough to need comments, and a one-liner cannot hold
# them. See apps/web-marketing/Caddyfile for why the try_files order matters.
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80

# Kept in the image on purpose: infra/docker-compose.prod.yml declares no
# `healthcheck:` for this service, so `healthcheckOwner()` in
# scripts/check-infra-review.mjs resolves it from here. Dropping this line
# silently leaves the service with no healthcheck at all.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ > /dev/null || exit 1
