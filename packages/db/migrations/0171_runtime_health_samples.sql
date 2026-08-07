-- 0171_runtime_health_samples.sql
-- Retained history for the Runtime Health card.
--
-- The monitor worker already computes every one of these numbers on a 5-minute
-- tick and then throws them away, so the card can only ever answer "how is it
-- right now". Keeping the samples is what makes "when did connections start
-- climbing, and was it during the 14:00 pool round?" answerable at all —
-- Prometheus was deliberately not adopted (docs/OBSERVABILITY_REVIEW.md).
--
-- Every metric column is nullable ON PURPOSE. The collectors run under
-- Promise.allSettled, so one failing (Redis down, df unavailable) must still
-- record the rest of the row rather than lose the whole sample. A NULL here
-- means "not collected on this tick", which is itself the signal.
--
-- RLS deny-all, matching 0157: no policies at all, so only the service_role
-- (BYPASSRLS) reads or writes. This is machine telemetry, never organizer data,
-- and it carries no event_id/tournament_id — so the archive coverage guard does
-- not scan it and it is correctly absent from TABLE_TO_ARCHIVE_KEY.

create table public.runtime_health_samples (
  id                     bigint generated always as identity primary key,
  sampled_at             timestamptz not null default now(),
  overall                text not null check (overall in ('healthy', 'warning', 'critical', 'unavailable')),

  -- database
  conn_in_use            int,
  conn_max               int,
  db_size_bytes          bigint,
  longest_query_seconds  numeric(12, 3),
  -- A FRACTION in 0..1, not a percentage: admin_runtime_db_stats() (0156)
  -- returns round(blks_hit / (blks_hit + blks_read), 4) and the card multiplies
  -- by 100 for display. Scale 4 matches that round() exactly.
  cache_hit_ratio        numeric(5, 4),

  -- redis
  redis_used_bytes       bigint,
  redis_max_bytes        bigint,

  -- queues (BullMQ, summed across queues)
  queue_waiting          int,
  queue_failed           int,

  -- disk
  disk_use_pct           numeric(5, 2)
);

-- Every read is "the last N hours, newest first", and the prune deletes by age.
create index runtime_health_samples_sampled_at_idx
  on public.runtime_health_samples (sampled_at desc);

alter table public.runtime_health_samples enable row level security;
-- No policies: only the service_role (BYPASSRLS) may read/write.
