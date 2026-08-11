-- 0183_event_feedback.sql
-- How the event went, from everyone who was there.
--
-- Widened from "referees rate the event": fighters, referees, instructors and
-- workshop attendees can all answer. `persons` is the event's WHOLE roster —
-- referees, staff and workshop-only attendees included — and a guest carries a
-- persons.id with no account, so keying on it reaches people who never log in
-- without inventing a second identity.
--
-- ── Anonymity ───────────────────────────────────────────────────────────────
--
-- Anonymous to the organiser BY DEFAULT. respondent_person_id is stored on every
-- row regardless — it is what makes one-response-per-person enforceable and
-- gives a super admin a handle for abuse — but the organiser projection reads
-- `is_attributed` and omits the id unless the respondent ticked the box that
-- said, in as many words, that the organiser would see their name.
--
-- The flag is a column rather than "store the id only when attributed" because
-- the UNIQUE below needs the id in both cases. Enforcement therefore lives in
-- the read path, and its test asserts the id cannot appear for an unattributed
-- row under any query shape.
--
-- respondent_role is DERIVED from the roster at write time, never self-declared:
-- a fighter must not be able to file as a referee and shift what an organiser
-- concludes about their officials.

create table public.event_feedback (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events(id) on delete cascade,
  -- Always set. Never projected to the organiser unless is_attributed.
  respondent_person_id uuid not null references public.persons(id) on delete cascade,
  -- Derived from the roster, not the client.
  respondent_role      text not null check (
                         respondent_role in ('fighter', 'referee', 'instructor', 'attendee')
                       ),
  -- 1..5. Deliberately one number plus free text: a long form at the end of a
  -- tiring day is a form nobody fills in.
  rating               smallint not null check (rating between 1 and 5),
  comment              text check (comment is null or length(comment) <= 2000),
  -- The respondent asked to be named. Default false: silence means anonymous.
  is_attributed        boolean not null default false,
  submitted_at         timestamptz not null default now(),
  -- One response per person per event. Editing replaces rather than appends, so
  -- a second thought does not read as a second respondent.
  unique (event_id, respondent_person_id)
);

comment on table public.event_feedback is
  'Post-event feedback from the whole roster. Anonymous to the organiser unless '
  'is_attributed; respondent_person_id is stored always and projected never, '
  'except for attributed rows and for super admins.';

comment on column public.event_feedback.is_attributed is
  'The respondent opted IN to being named. The organiser projection must read '
  'this rather than relying on a caller passing the right filter.';

create index if not exists event_feedback_event_idx
  on public.event_feedback (event_id, submitted_at desc);

-- Deny-all: PostgREST exposes `public` as `anon`, so a table without RLS is
-- world-readable — and this one holds opinions people gave believing they were
-- anonymous. Only the service role (which bypasses RLS) touches it.
alter table public.event_feedback enable row level security;
