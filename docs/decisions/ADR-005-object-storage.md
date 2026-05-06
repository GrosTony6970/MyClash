# ADR-005 — Object storage at v1: Supabase Storage

**Date:** 2025-01-01
**Status:** Accepted

## Context

MyClash needs object storage for:

- Fighter profile photos
- Event logos and banner images
- Podium/ceremony photos

Requirements: EU-hosted, S3-compatible API, self-hostable alongside the rest of the stack, low operational overhead for v1.

## Decision

**Supabase Storage** (self-hosted as part of the Supabase stack).

Supabase Storage is S3-compatible, runs as a Docker container (`supabase/storage-api`), and integrates natively with Supabase Auth for access control policies. It stores objects on-disk in a Docker volume (`storage_data`) which is backed up by `infra/scripts/backup.sh`.

## Consequences

- **Easy:** No separate storage account or credentials to manage at v1. Access policies defined alongside DB RLS policies.
- **Hard:** On-disk storage means the VPS disk is the capacity ceiling. At scale, migrating to a managed S3 bucket (Scaleway Object Storage) would be needed.
- **Committed to:** All file upload/download goes through the Supabase Storage API. The storage volume is included in nightly backups.

## Alternatives considered

- **Scaleway Object Storage (S3)** — EU-hosted, cheap, managed. Deferred to v2 when disk limits become a concern.
- **MinIO** — More control, but adds another service to operate.
- **Cloudflare R2** — No egress fees, but adds a non-EU dependency for data residency.
