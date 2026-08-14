-- 0187_global_persons_directory_listing.sql
-- Record whether a fighter is listed in the public directory, and whether
-- search engines may index their profile.
--
-- ── Why a column, and why here ────────────────────────────────────────────────
--
-- The platform has never recorded consent to be listed. `public_visibility`
-- (0126) is a per-FIELD map: it can hide a bio, an alias, a date of birth. It
-- cannot hide a person. Name, slug, photo, club, weapons, medals and results are
-- public unconditionally, and the population is auto-minted by third parties --
-- every `persons` row gets a `global_person_id`, so a CSV import creates a live
-- public profile for somebody who has never visited MyClash.
--
-- The flag goes on `global_persons`, not `person_privacy`, because
-- `person_privacy.person_id` references `persons(id)`, which is EVENT-SCOPED: a
-- competitor in five events would hold five contradictory answers to one
-- question. (0187's sibling commit fixes the same shape for the privacy
-- settings that already live there.) It is a column rather than a key in the
-- `public_visibility` JSONB because the directory query filters and paginates on
-- it, and a JSONB key cannot carry the partial index below.
--
-- ── Why the names are about STATE, not consent ────────────────────────────────
--
-- Nobody consented. A column called `directory_consent` would assert something
-- that never happened for the imported majority. `listed_in_directory` says what
-- is true: this row is, or is not, listed.
--
-- ── Why listed_in_directory DEFAULT TRUE is safe ──────────────────────────────
--
-- Because the claim gate carries the weight, not the default. The directory
-- predicate also requires `claimed_by_user_id IS NOT NULL`, so an unclaimed
-- imported row is excluded regardless of what this column says. TRUE therefore
-- means "listed unless you say otherwise" only for people who signed up
-- themselves, accepted terms, and can see and operate the toggle.
--
-- ── Why search_indexable DEFAULT FALSE ────────────────────────────────────────
--
-- Because indexing is the half that cannot be undone. De-indexing is slow, and
-- it never reaches caches or scrapers, so it has to be actively chosen rather
-- than actively escaped.
--
-- ── Why the CHECK, and why it is named ────────────────────────────────────────
--
-- Indexing is NESTED inside listing: indexed-but-unlisted would be an orphan
-- page reachable only from a search result, with no route to it from the site.
-- Making that unrepresentable beats discouraging it in a code comment.
--
-- The constraint is named explicitly because an auto-named CHECK fails to drop
-- silently on replay, and this one will need editing if the nesting rule ever
-- changes.

alter table public.global_persons
  add column if not exists listed_in_directory boolean not null default true,
  add column if not exists search_indexable    boolean not null default false,
  add column if not exists listing_changed_at  timestamptz;

comment on column public.global_persons.listed_in_directory is
  'Whether this person appears in the public fighter directory. Default TRUE is '
  'safe only because the directory predicate also requires claimed_by_user_id IS '
  'NOT NULL, so imported rows nobody claimed are excluded regardless.';

comment on column public.global_persons.search_indexable is
  'Whether search engines may index this profile. Nested inside '
  'listed_in_directory by a CHECK. Defaults FALSE because de-indexing is slow '
  'and never reaches caches or scrapers.';

comment on column public.global_persons.listing_changed_at is
  'When the person last changed either flag themselves. NULL means they never '
  'have, which is what distinguishes an untouched default from a choice.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'global_persons_indexable_requires_listed'
      and conrelid = 'public.global_persons'::regclass
  ) then
    alter table public.global_persons
      add constraint global_persons_indexable_requires_listed
      check (not search_indexable or listed_in_directory);
  end if;
end $$;

-- Covers the directory's ORDER BY, and is partial so it holds only the rows the
-- directory can actually return.
create index if not exists global_persons_directory_idx
  on public.global_persons (family_name, given_name)
  where listed_in_directory and claimed_by_user_id is not null and is_fighter;

-- ── RLS ───────────────────────────────────────────────────────────────────────
--
-- Hard rule 4: RLS first, application checks second. `global_persons_select`
-- (0024) is `USING (TRUE)`, so the directory gate this migration introduces
-- would be bypassable straight through PostgREST as `anon` -- along with email,
-- date_of_birth and claimed_by_user_id, which no policy has ever withheld.
--
-- Safe to tighten because the API reads this table via supabase.service, and the
-- service role is BYPASSRLS: only DIRECT anon/authenticated access changes.
-- Three things were checked before writing this, because each would have failed
-- silently rather than loudly:
--
--   1. No browser code queries global_persons through PostgREST.
--   2. The table is not in the supabase_realtime publication -- a subscriber's
--      RLS is evaluated per row, so a channel would simply have gone quiet.
--   3. Two views LEFT JOIN this table, and one of them is load-bearing on it:
--      vw_tournament_query_referees builds `judge_name` ENTIRELY from
--      gp.given_name || gp.family_name, so a row hidden by RLS would blank every
--      referee's name rather than omit the row. Referees are usually
--      is_fighter = false and would be filtered by the predicate below. This is
--      safe only because 0184 set security_invoker on all five
--      vw_tournament_query_* views AND revoked them from anon and authenticated:
--      they are reachable by service_role alone, which bypasses RLS entirely.
--      If that REVOKE is ever dropped to expose one publicly, this policy is the
--      reason judge_name would go blank.
--
-- Three disjuncts, because "listed" is not the only reason to read a row:
--   1. platform staff administer these records;
--   2. a user must always be able to read their OWN row, listed or not;
--   3. everyone else sees exactly the directory population.

drop policy if exists "global_persons_select" on public.global_persons;

create policy "global_persons_select" on public.global_persons
  for select using (
    is_super_admin()
    or claimed_by_user_id = auth.uid()
    or (
      listed_in_directory
      and claimed_by_user_id is not null
      and is_fighter
      and deleted_at is null
      and merged_into_id is null
      and account_deleted_at is null
    )
  );

NOTIFY pgrst, 'reload schema';
