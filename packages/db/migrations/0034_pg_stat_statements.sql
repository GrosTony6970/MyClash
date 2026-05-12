-- Phase 4 production review: query diagnostics extension.
-- Requires the Postgres image/runtime to allow pg_stat_statements. On hosts
-- that require shared_preload_libraries, enable that before relying on stats.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
