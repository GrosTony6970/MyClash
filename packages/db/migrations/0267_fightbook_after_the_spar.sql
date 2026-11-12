-- 0267: FightBook, slice 3 — after the spar (rulings 677-690).
--
-- Slice 1 stored a spar as an agreed request. This slice lets both fighters say "we sparred", then
-- thank each other, review anonymously, favourite a fighter, and (if they choose) show their stars
-- on the public page.
--
-- 1. `done` becomes a status of `spar_requests` (agreed -> done -> undo -> agreed). It carries no
--    "marked by" and no "marked at": both windows run from `expires_at` (mark and undo until 48 h
--    after it), and the data download carries whole rows. The status CHECK is replaced in full:
--    `done` has `agreed_at` and no cancel or comment field, so a spar can never be both cancelled
--    and done (a cancel and a "we sparred" that race: one conditional update wins).
--
-- 2. `spar_thanks`: a SIGNED thank-you, 1-5 stars and an optional text, one per author per spar.
--    The subject sees the stars and the text (ruling 690) and who wrote them.
--
-- 3. `spar_anonymous_reviews`: an anonymous review, the same columns without a text. It is its
--    own table so the subject's data download can leave it out whole: the export reaches tables
--    by column, and a row ABOUT the subject names its writer (Art. 15(4)). Accepted (ruling 688):
--    in a small circle the subject can guess the writer from the timing. The writer's name never
--    appears in any payload, card or list the subject reads.
--
-- 4. `fightbook_favourites`: a fighter's own shortlist. Never readable by the favourite.
--
-- 5. `global_persons.fightbook_show_stars`, default OFF (ruling 682): the star average on the
--    public page shows only when the fighter switches it on. Readable like `fightbook_enabled`
--    (0263): only the switch, never the number.
--
-- 6. `fightbook_review`: write a review in ONE transaction, in the 0264 lock order (the two
--    profiles KEY SHARE in id order, so a merge's FOR UPDATE waits for it or it for the merge,
--    never each for the other; then the request row FOR UPDATE, so an undo waits). It judges the
--    window on the API's clock (`p_now`): a review opens 48 h after `expires_at`, once the spar is
--    `done`. Every refusal is `not_open` (P0001), a double write included. The star average moves
--    after each review (ruling 688) and shows from the first one (ruling 689).
--
-- 7. `fightbook_star_line`: `{ average, count }` over both review tables for one subject. The
--    repo turns PostgREST aggregates off and a row read stops at the 1000-row page, so the average
--    is one SQL call.
--
-- Deny-all: RLS on, no policy; the API reads and writes these as the service role (0247). Every
-- CHECK is a CASE with ELSE false: a CHECK written as an OR of comparisons reads NULL and passes.
-- SECURITY INVOKER, search_path pinned, service role only (the 0264 shape).

ALTER TABLE public.global_persons
  ADD COLUMN IF NOT EXISTS fightbook_show_stars BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.spar_requests
  DROP CONSTRAINT spar_requests_status_shape,
  ADD CONSTRAINT spar_requests_status_shape CHECK (
    CASE status
      WHEN 'pending' THEN agreed_at IS NULL AND cancelled_by IS NULL AND cancel_message IS NULL
                          AND shared_comment IS NULL
      WHEN 'withdrawn' THEN agreed_at IS NULL AND cancelled_by IS NULL AND cancel_message IS NULL
                            AND shared_comment IS NULL
      WHEN 'agreed' THEN agreed_at IS NOT NULL AND cancelled_by IS NULL AND cancel_message IS NULL
                         AND shared_comment IS NULL
      WHEN 'done' THEN agreed_at IS NOT NULL AND cancelled_by IS NULL AND cancel_message IS NULL
                       AND shared_comment IS NULL
      WHEN 'not_this_time' THEN agreed_at IS NULL AND cancelled_by IS NULL AND cancel_message IS NULL
      WHEN 'cancelled' THEN agreed_at IS NOT NULL AND cancelled_by IS NOT NULL
                            AND shared_comment IS NULL
      ELSE false END);

CREATE TABLE IF NOT EXISTS public.spar_thanks (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spar_request_id           UUID NOT NULL REFERENCES public.spar_requests(id) ON DELETE CASCADE,
  author_global_person_id   UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  subject_global_person_id  UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  stars                     SMALLINT NOT NULL,
  body                      TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spar_thanks_two_fighters CHECK (
    CASE WHEN author_global_person_id <> subject_global_person_id THEN true ELSE false END),
  CONSTRAINT spar_thanks_stars CHECK (
    CASE WHEN stars BETWEEN 1 AND 5 THEN true ELSE false END),
  CONSTRAINT spar_thanks_body CHECK (
    CASE WHEN body IS NULL THEN true
         WHEN char_length(body) BETWEEN 1 AND 500 THEN true
         ELSE false END)
);

COMMENT ON TABLE public.spar_thanks IS
  'FightBook: a signed thank-you after a spar (stars and an optional text). Deny-all; API only.';

CREATE UNIQUE INDEX IF NOT EXISTS spar_thanks_author_uk
  ON public.spar_thanks (spar_request_id, author_global_person_id);
CREATE INDEX IF NOT EXISTS spar_thanks_subject_idx
  ON public.spar_thanks (subject_global_person_id, created_at);
CREATE INDEX IF NOT EXISTS spar_thanks_author_idx
  ON public.spar_thanks (author_global_person_id);

ALTER TABLE public.spar_thanks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.spar_anonymous_reviews (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spar_request_id           UUID NOT NULL REFERENCES public.spar_requests(id) ON DELETE CASCADE,
  author_global_person_id   UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  subject_global_person_id  UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  stars                     SMALLINT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spar_anonymous_reviews_two_fighters CHECK (
    CASE WHEN author_global_person_id <> subject_global_person_id THEN true ELSE false END),
  CONSTRAINT spar_anonymous_reviews_stars CHECK (
    CASE WHEN stars BETWEEN 1 AND 5 THEN true ELSE false END)
);

COMMENT ON TABLE public.spar_anonymous_reviews IS
  'FightBook: an anonymous star review after a spar. Its subject never reads the writer. Deny-all; API only.';

CREATE UNIQUE INDEX IF NOT EXISTS spar_anonymous_reviews_author_uk
  ON public.spar_anonymous_reviews (spar_request_id, author_global_person_id);
CREATE INDEX IF NOT EXISTS spar_anonymous_reviews_subject_idx
  ON public.spar_anonymous_reviews (subject_global_person_id);
CREATE INDEX IF NOT EXISTS spar_anonymous_reviews_author_idx
  ON public.spar_anonymous_reviews (author_global_person_id);

ALTER TABLE public.spar_anonymous_reviews ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fightbook_favourites (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_global_person_id      UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  favourite_global_person_id  UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fightbook_favourites_two_fighters CHECK (
    CASE WHEN owner_global_person_id <> favourite_global_person_id THEN true ELSE false END)
);

COMMENT ON TABLE public.fightbook_favourites IS
  'FightBook: a fighter''s own shortlist. Never readable by the favourite. Deny-all; API only.';

CREATE UNIQUE INDEX IF NOT EXISTS fightbook_favourites_pair_uk
  ON public.fightbook_favourites (owner_global_person_id, favourite_global_person_id);
CREATE INDEX IF NOT EXISTS fightbook_favourites_favourite_idx
  ON public.fightbook_favourites (favourite_global_person_id);

ALTER TABLE public.fightbook_favourites ENABLE ROW LEVEL SECURITY;

create or replace function public.fightbook_review(
  p_request   uuid,
  p_author    uuid,
  p_stars     smallint,
  p_body      text,
  p_anonymous boolean,
  p_now       timestamptz
)
returns void
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_asker    uuid;
  v_receiver uuid;
  v_subject  uuid;
begin
  select r.asker_global_person_id, r.receiver_global_person_id
    into v_asker, v_receiver
    from public.spar_requests r where r.id = p_request;
  if v_asker is null then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  perform 1 from public.global_persons
   where id in (v_asker, v_receiver)
   order by id for key share;

  -- The row again, locked (an undo waits), with both profile columns re-checked: a merge that ran
  -- between the plain read and the lock moved them.
  select case when r.asker_global_person_id = p_author then r.receiver_global_person_id
              else r.asker_global_person_id end
    into v_subject
    from public.spar_requests r
   where r.id = p_request
     and r.asker_global_person_id = v_asker and r.receiver_global_person_id = v_receiver
     and p_author in (r.asker_global_person_id, r.receiver_global_person_id)
     and r.status = 'done'
     and r.expires_at + interval '48 hours' <= p_now
   for update;
  if v_subject is null then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  -- The author is live (merged, deleted or erased profiles write nothing). FightBook may be off:
  -- an off fighter still finishes their spars (ruling 666).
  if not exists (
    select 1 from public.global_persons g
     where g.id = p_author and g.merged_into_id is null and g.deleted_at is null
       and g.account_deleted_at is null
  ) then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.spar_thanks t
              where t.spar_request_id = p_request and t.author_global_person_id = p_author)
     or exists (select 1 from public.spar_anonymous_reviews a
                 where a.spar_request_id = p_request and a.author_global_person_id = p_author) then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  begin
    if coalesce(p_anonymous, false) then
      insert into public.spar_anonymous_reviews
        (spar_request_id, author_global_person_id, subject_global_person_id, stars, created_at)
      values (p_request, p_author, v_subject, p_stars, p_now);
    else
      insert into public.spar_thanks
        (spar_request_id, author_global_person_id, subject_global_person_id, stars, body, created_at)
      values (p_request, p_author, v_subject, p_stars, nullif(btrim(coalesce(p_body, '')), ''), p_now);
    end if;
  exception when unique_violation then
    raise exception 'not_open' using errcode = 'P0001';
  end;
end;
$$;

revoke all on function public.fightbook_review(uuid, uuid, smallint, text, boolean, timestamptz) from public;
revoke execute on function public.fightbook_review(uuid, uuid, smallint, text, boolean, timestamptz) from anon, authenticated;
grant execute on function public.fightbook_review(uuid, uuid, smallint, text, boolean, timestamptz) to service_role;

create or replace function public.fightbook_star_line(p_subject uuid)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'average', case when count(*) = 0 then null else round(avg(s.stars), 1) end,
    'count', count(*))
    from (
      select t.stars from public.spar_thanks t where t.subject_global_person_id = p_subject
      union all
      select a.stars from public.spar_anonymous_reviews a where a.subject_global_person_id = p_subject
    ) s;
$$;

revoke all on function public.fightbook_star_line(uuid) from public;
revoke execute on function public.fightbook_star_line(uuid) from anon, authenticated;
grant execute on function public.fightbook_star_line(uuid) to service_role;

NOTIFY pgrst, 'reload schema';
