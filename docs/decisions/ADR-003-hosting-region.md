# ADR-003 — Hosting region: EU (OVH VPS)

**Date:** 2025-01-01
**Status:** Accepted

## Context

MyClash handles personal data of HEMA competitors across Europe (names, email addresses, fight records). The platform must comply with GDPR. Hosting choices affect:

- GDPR data residency obligations
- Latency for the primary audience (EU-based clubs and events)
- Cost and operational simplicity

## Decision

**OVH VPS in France (Gravelines or Roubaix data centre).**

Single VPS running the full stack via Docker Compose. No multi-region, no Kubernetes — keeping ops simple for a volunteer-run project.

## Consequences

- **Easy:** GDPR data residency is satisfied by default; no data leaves the EU. Latency is good for French and Western European users.
- **Hard:** Single-region means no geographic redundancy; a VPS outage takes down the platform. Acceptable for a v1 community tool — PITR backups mitigate data loss risk.
- **Committed to:** All infrastructure (database, object storage, Redis) runs on the same VPS or within the EU. If a managed service is added (e.g. S3-compatible storage), it must be EU-hosted (Scaleway Paris).

## Alternatives considered

- **Hetzner (Germany)** — Also EU, slightly cheaper; OVH chosen for familiarity and existing account.
- **AWS eu-west-1** — More expensive; vendor lock-in; overkill for v1 traffic.
- **Fly.io** — Interesting for easy deploys but adds operational complexity vs. a plain VPS.
