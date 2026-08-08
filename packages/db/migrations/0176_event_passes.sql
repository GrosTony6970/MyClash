-- 0176_event_passes.sql
--
-- The personal event pass: the QR a fighter presents at the check-in desk.
--
-- ## Why a token and not a person id
--
-- `assertPersonInEvent` (checkin.service.ts) checks that a scanned person
-- belongs to the SAME event as the scanning staff account. It does not
-- authenticate the bearer, and it cannot — it is handed an id, not a
-- credential. So a QR carrying a raw `persons.id` would be forgeable by anyone
-- who has ever seen another roster row's id, and roster ids reach every org
-- editor and every public participant projection.
--
-- The pass is therefore a bearer secret: 32 random bytes, base64url in the QR,
-- and only its sha256 written down here. Shape follows the two existing
-- implementations of this pattern — `person_email_change_requests` (0020) and
-- `global_person_claim_tokens` (0142): a surrogate `id` primary key plus
-- `token_hash TEXT NOT NULL UNIQUE`, looked up by hashing what the scanner
-- read. A database dump, a nightly backup or a service-role read yields
-- nothing presentable at a desk.
--
-- ## Where this DIFFERS from those two, deliberately
--
-- Both precedents are SINGLE-USE and one-hour-lived, and both DELETE the row
-- the moment the token is redeemed. Copying that here would break the pass on
-- its second use: a fighter presents it Saturday morning, again after lunch
-- when the desk re-opens for the afternoon tournament, and again on Sunday.
--
-- So this row SURVIVES a scan. `last_scanned_at` and `scan_count` are updated
-- instead of deleting, which also makes "was the fast lane used at all?" a
-- readable question after a real event — the other half of the measurement
-- `event_arrivals.via` was added for in 0174.
--
-- ## One live pass per (event, person)
--
-- The UNIQUE index below means issuing a pass REPLACES the previous one rather
-- than accumulating credentials. That is the property that makes "I lost my
-- phone, send me a new pass" actually revoke the old one instead of leaving two
-- working QRs in the world.
--
-- The cost is stated plainly: because only the hash is stored, the API cannot
-- re-read a token it already issued. A participant's device keeps the raw value
-- it was handed (so the pass renders with no signal at the venue, which is
-- where it is presented); opening the pass on a SECOND device issues a fresh
-- token and retires the first. Search by name is the desk's primary path and
-- remains the fallback for every case where that bites.
--
-- ## Grain
--
-- Per (event, person), matching `event_arrivals`. NOT per registration: 0174
-- already rejected that grain because a fighter entered in longsword and rapier
-- would carry two passes for one walk through the door. Note `persons` is
-- itself event-scoped, so the same human holds a different pass at every event.
--
-- ## Informational, like everything else in this desk
--
-- Scanning a pass records an arrival. Arrival gates nothing — no scoring or
-- scheduling path reads it, per 0174. A pass is not a ticket and not an
-- admission credential; it is a faster way to type a name.

CREATE TABLE IF NOT EXISTS event_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,

  -- sha256(raw token), hex. The raw value exists only in the QR on the
  -- participant's screen and, for an emailed pass, in their inbox.
  token_hash TEXT NOT NULL UNIQUE,

  -- 'self'  = the participant opened their pass and the API issued it
  -- 'email' = the organiser mailed it to a roster entry that has no account
  -- Recorded for the same reason as event_arrivals.via: the two paths have
  -- different reach, and only the counts say which one was worth building.
  issued_via TEXT NOT NULL DEFAULT 'self',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Set from the event's end date at issue time, mirroring how a guest session
  -- expires (end_date + 7 days). A pass is only meaningful during its event, so
  -- an unbounded secret store would be carrying risk for nothing. NULL when the
  -- event has no end date — a draft or a club night often does not.
  expires_at TIMESTAMPTZ,

  -- Survives a scan rather than being deleted. See the header.
  last_scanned_at TIMESTAMPTZ,
  scan_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE event_passes
  DROP CONSTRAINT IF EXISTS event_passes_issued_via_allowed;
ALTER TABLE event_passes
  ADD CONSTRAINT event_passes_issued_via_allowed
  CHECK (issued_via IN ('self', 'email'));

-- One live pass per person per event: re-issuing REPLACES rather than adding,
-- so a reissue actually retires the lost one. Mirrors the key on
-- event_arrivals; `persons` is already event-scoped, so person_id alone would
-- determine the event, but carrying event_id keeps "every pass for this event"
-- a one-hop query and keeps the two desk tables the same shape.
CREATE UNIQUE INDEX IF NOT EXISTS event_passes_event_person_key
  ON event_passes(event_id, person_id);

-- The organiser's "who has a pass / who still needs one" read before a mail-out.
CREATE INDEX IF NOT EXISTS event_passes_event_idx
  ON event_passes(event_id);

COMMENT ON TABLE event_passes IS
  'Personal event pass tokens, stored hashed. A scan records an arrival and nothing else - a pass is not a ticket and gates no match. Unlike the other token_hash tables this row SURVIVES redemption: a pass is presented many times across an event.';
COMMENT ON COLUMN event_passes.token_hash IS
  'sha256 hex of the raw token. The raw value is returned once at issue time and never written down.';
COMMENT ON COLUMN event_passes.issued_via IS
  'self | email - how the participant got their pass. Measures the reach of each path, like event_arrivals.via.';
COMMENT ON COLUMN event_passes.scan_count IS
  'Incremented per successful scan instead of deleting the row, so a pass works on day two.';

-- RLS ON, NO POLICIES: deny-all, service_role only.
--
-- Shape follows 0065_admin_user_temp_passwords.sql and the deny-all block in
-- 0141_rls_catchup.sql, which put `global_person_claim_tokens` in exactly this
-- posture. This is a secret store: an org editor has no business reading token
-- hashes through PostgREST, so unlike `event_arrivals` there is deliberately no
-- permissive policy here. Without ENABLE ROW LEVEL SECURITY PostgREST would
-- expose `public` as `anon` and the whole table would be world-readable.
ALTER TABLE event_passes ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
