-- 0181_matches_touch_updated_at.sql
-- Make matches.updated_at mean what its name says.
--
-- The column has existed since 0001 and was maintained by nobody: there is no
-- trigger in any migration, and the normal completion path (clock.service.ts
-- `action === 'end'`) writes status / ended_at / duration_* and leaves
-- updated_at at the row's insert time. Only match-forfeits.service.ts sets it,
-- by hand, in seven places. So a match played start to finish on the pad looks
-- untouched since creation, while a forfeited one looks freshly modified —
-- exactly backwards from what any reader would assume.
--
-- Nothing read the column, which is why this never surfaced as a bug: no API
-- select, no frontend, no E2E spec names it. (The `updated_at` in
-- frozen-results.guard.ts belongs to exchange_edit_requests, not matches.)
-- That also makes this migration safe — it can only make an unread column
-- truthful. The league staleness badge is the first reader, and it needs
-- "when did this tournament's results last change" to be answerable without
-- enumerating every write path that might have changed them.
--
-- The seven hand-writes in match-forfeits.service.ts are now redundant rather
-- than wrong: BEFORE UPDATE runs after them and sets the same now().

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.touch_updated_at() is
  'Generic BEFORE UPDATE trigger: stamps updated_at = now() on the new row. '
  'Attach to any table whose updated_at must be trustworthy rather than '
  'dependent on every writer remembering to set it.';

-- Idempotent: this migration is replayed against a throwaway PG17 during
-- verification, and drop-then-create is the only form that survives a re-run
-- without a duplicate_object throw.
drop trigger if exists matches_touch_updated_at on public.matches;

create trigger matches_touch_updated_at
  before update on public.matches
  for each row
  execute function public.touch_updated_at();

-- Existing rows keep their stale value. Backfilling to now() would be a lie in
-- the other direction — it would claim every historical match changed at
-- migration time, which is precisely the false "everything is stale" reading
-- the badge exists to avoid. Rows written before this migration simply have no
-- honest answer, and a NULL-free column cannot say so; leaving them is the
-- least wrong option and only affects events already played.
