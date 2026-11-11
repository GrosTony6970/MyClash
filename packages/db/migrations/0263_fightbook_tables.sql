-- 0263: FightBook, slice 1 — the switch and the three tables
-- (docs/superpowers/specs/2026-11-10-fightbook-design.md, rulings 642-665).
--
-- A Spar is one friendly, unscored meeting between two fighters (docs/HIERARCHY.md). FightBook keys
-- on the fighter profile (`global_persons`), never on the account: one profile per account (0063),
-- and the profile is what a fighter asks.
--
-- 1. `global_persons.fightbook_enabled`, default OFF: FightBook is new social exposure, so a
--    fighter opts in. Off means nobody may ask them and they may ask nobody. Like
--    `allow_being_followed` (0211, ruling 155), the 0187 policy lets anyone read it on a listed
--    fighter's row; that is accepted (anyone who switches FightBook on sees who else is on it).
--
-- 2. `spar_requests`: one row is one request, and an agreed request is the spar. `kind` says
--    whether it names an Event day or a free date and place. It is a column, not inferred from
--    `event_id`, because deleting the Event sets `event_id` null (the request survives) and the
--    shape CHECK must still hold. The zone is copied in at ask time for both kinds, so the day
--    and time still read after that delete.
--
--    The stored statuses are pending, agreed, not_this_time, withdrawn and cancelled. No reason
--    and no decline time is stored: a decline, a block and a request that ran out all end as the
--    same `not_this_time` row, so not even the asker's own data download can tell them apart.
--    A comment the decliner keeps private lives in `spar_private_notes`, never on the row.
--
-- 3. `spar_private_notes`: a fighter's private note on a request (the private "Not this time"
--    comment now; slice 3's private review note later). Only its writer reads it.
--
-- 4. `fightbook_blocks`: who blocked whom. Never readable by the blocked fighter.
--
-- Deny-all: RLS on, no policy; the API reads and writes these as the service role (0247: a new
-- table starts closed to web writes). Every CHECK is a CASE with ELSE false: a CHECK written as an
-- OR of comparisons reads NULL and passes.

ALTER TABLE public.global_persons
  ADD COLUMN fightbook_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.spar_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_global_person_id    UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  receiver_global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  kind                      TEXT NOT NULL,
  event_id                  UUID REFERENCES public.events(id) ON DELETE SET NULL,
  spar_day                  DATE NOT NULL,
  zone                      TEXT NOT NULL,
  spar_time                 TIME,
  place                     TEXT,
  weapons                   TEXT[] NOT NULL,
  message                   TEXT,
  status                    TEXT NOT NULL DEFAULT 'pending',
  expires_at                TIMESTAMPTZ NOT NULL,
  shared_comment            TEXT,
  agreed_at                 TIMESTAMPTZ,
  cancelled_by              TEXT,
  cancel_message            TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spar_requests_two_fighters CHECK (
    CASE WHEN asker_global_person_id <> receiver_global_person_id THEN true ELSE false END),
  CONSTRAINT spar_requests_kind_shape CHECK (
    CASE kind
      WHEN 'event' THEN place IS NULL
      WHEN 'free' THEN event_id IS NULL AND place IS NOT NULL
      ELSE false END),
  CONSTRAINT spar_requests_status_shape CHECK (
    CASE status
      WHEN 'pending' THEN agreed_at IS NULL AND cancelled_by IS NULL AND cancel_message IS NULL
                          AND shared_comment IS NULL
      WHEN 'withdrawn' THEN agreed_at IS NULL AND cancelled_by IS NULL AND cancel_message IS NULL
                            AND shared_comment IS NULL
      WHEN 'agreed' THEN agreed_at IS NOT NULL AND cancelled_by IS NULL AND cancel_message IS NULL
                         AND shared_comment IS NULL
      WHEN 'not_this_time' THEN agreed_at IS NULL AND cancelled_by IS NULL AND cancel_message IS NULL
      WHEN 'cancelled' THEN agreed_at IS NOT NULL AND cancelled_by IS NOT NULL
                            AND shared_comment IS NULL
      ELSE false END),
  CONSTRAINT spar_requests_cancelled_by CHECK (
    CASE WHEN cancelled_by IS NULL THEN true
         WHEN cancelled_by IN ('asker', 'receiver') THEN true
         ELSE false END),
  CONSTRAINT spar_requests_weapons CHECK (
    CASE WHEN cardinality(weapons) BETWEEN 1 AND 5 THEN true ELSE false END),
  CONSTRAINT spar_requests_texts CHECK (
    CASE WHEN message IS NOT NULL AND char_length(message) NOT BETWEEN 1 AND 500 THEN false
         WHEN shared_comment IS NOT NULL AND char_length(shared_comment) NOT BETWEEN 1 AND 500 THEN false
         WHEN cancel_message IS NOT NULL AND char_length(cancel_message) NOT BETWEEN 1 AND 500 THEN false
         WHEN place IS NOT NULL AND char_length(place) NOT BETWEEN 1 AND 200 THEN false
         ELSE true END)
);

COMMENT ON TABLE public.spar_requests IS
  'FightBook: one spar request between two fighter profiles; agreed = the spar. Deny-all; API only.';

CREATE INDEX IF NOT EXISTS spar_requests_receiver_idx
  ON public.spar_requests (receiver_global_person_id, status, spar_day);
CREATE INDEX IF NOT EXISTS spar_requests_asker_idx
  ON public.spar_requests (asker_global_person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS spar_requests_event_idx
  ON public.spar_requests (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS spar_requests_one_pending_uk
  ON public.spar_requests (asker_global_person_id, receiver_global_person_id)
  WHERE status = 'pending';
-- The hourly job ends unanswered requests past their day (spar-request-expiry.worker.ts).
CREATE INDEX IF NOT EXISTS spar_requests_pending_expiry_idx
  ON public.spar_requests (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.spar_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.spar_private_notes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spar_request_id         UUID NOT NULL REFERENCES public.spar_requests(id) ON DELETE CASCADE,
  author_global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  body                    TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spar_private_notes_body CHECK (
    CASE WHEN char_length(body) BETWEEN 1 AND 500 THEN true ELSE false END)
);

COMMENT ON TABLE public.spar_private_notes IS
  'FightBook: a fighter''s private note on a spar request; only its writer reads it. Deny-all; API only.';

CREATE UNIQUE INDEX IF NOT EXISTS spar_private_notes_author_uk
  ON public.spar_private_notes (spar_request_id, author_global_person_id);
CREATE INDEX IF NOT EXISTS spar_private_notes_author_idx
  ON public.spar_private_notes (author_global_person_id);

ALTER TABLE public.spar_private_notes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fightbook_blocks (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  blocked_global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fightbook_blocks_two_fighters CHECK (
    CASE WHEN blocker_global_person_id <> blocked_global_person_id THEN true ELSE false END)
);

COMMENT ON TABLE public.fightbook_blocks IS
  'FightBook: who blocked whom. Never readable by the blocked fighter. Deny-all; API only.';

CREATE UNIQUE INDEX IF NOT EXISTS fightbook_blocks_pair_uk
  ON public.fightbook_blocks (blocker_global_person_id, blocked_global_person_id);
CREATE INDEX IF NOT EXISTS fightbook_blocks_blocked_idx
  ON public.fightbook_blocks (blocked_global_person_id);

ALTER TABLE public.fightbook_blocks ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
