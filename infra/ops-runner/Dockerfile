FROM node:26-bookworm-slim

# Docker's own apt repo, not Debian's `docker.io`. Debian ships the Docker CLI
# without the Compose v2 plugin, and every ops script drives the stack through
# `docker compose …` — so backup.sh silently took its "DB container not running"
# branch and produced storage-only backups that exited 1 with a misleading
# reason. `docker-ce-cli` is also the right package here: the runner talks to
# the host's mounted socket and has no use for a second daemon.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      awscli \
      bash \
      docker-ce-cli \
      docker-compose-plugin \
      gpg \
      gzip \
      tar \
 && rm -rf /var/lib/apt/lists/*

# Fail the BUILD rather than every nightly backup if the plugin is ever missing:
# the runtime symptom is a misreported "DB container not running", which cost a
# stretch of storage-only backups before anyone noticed.
RUN docker compose version

WORKDIR /app
COPY infra/ops-runner/ ./infra/ops-runner/

EXPOSE 4075
CMD ["node", "/app/infra/ops-runner/server.mjs"]
