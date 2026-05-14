FROM node:26-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      awscli \
      bash \
      ca-certificates \
      docker.io \
      gpg \
      gzip \
      tar \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY infra/ops-runner/ ./infra/ops-runner/

EXPOSE 4075
CMD ["node", "/app/infra/ops-runner/server.mjs"]
