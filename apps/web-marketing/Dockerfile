# apps/web-marketing/Dockerfile
#
# Minimal static site served by Caddy.
# The marketing site is plain HTML/CSS — no build step needed.

FROM caddy:2-alpine

# Copy static files
COPY public/ /usr/share/caddy/

# Minimal Caddyfile: serve static files, gzip, no logs to stdout noise
RUN printf ':80 {\n  root * /usr/share/caddy\n  file_server\n  encode gzip\n  try_files {path} /index.html\n}\n' > /etc/caddy/Caddyfile

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ > /dev/null || exit 1
