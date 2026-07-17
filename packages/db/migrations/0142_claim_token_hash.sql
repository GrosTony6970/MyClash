-- Migration 0142: store the global-profile claim token hashed, not plaintext.
--
-- 0075 created global_person_claim_tokens with `token uuid PRIMARY KEY` --
-- the raw secret itself, byte-identical to the string mailed to the user.
-- 0141 enabled RLS, which closed the *remote* read via anon/PostgREST and
-- flagged this as the remaining follow-up. This closes the at-rest half:
-- a DB dump, a nightly backup, or any service-role read path still hands
-- over live, usable tokens today.
--
-- The claim flow's only security property is possession of the victim's
-- mailbox. Storing the emailed token verbatim means reading the table is
-- equivalent to reading the inbox.
--
-- Shape mirrors 0020_person_email_change_requests.sql, which already solved
-- this exact problem (emailed one-time confirm token, 1h TTL): a surrogate
-- id primary key plus `token_hash TEXT NOT NULL UNIQUE`. The API mails the
-- raw token and looks rows up by sha256(token); the raw value is never
-- written down. RLS stays deny-all -- service_role is the only reader.
--
-- In-flight tokens are purged rather than migrated. They are 1h-lived and
-- their raw values exist only in inboxes, so they cannot be re-hashed; a
-- user mid-claim just clicks "claim" again and gets a fresh link. The
-- confirm page already renders that as `expired_or_used`.
--
-- NOTE: this ALTERs in place on purpose. Dropping and recreating the table
-- would silently discard the RLS enabled by 0141, and `pnpm db:review`
-- would not catch it -- its check is a static regex over all migration SQL,
-- so 0141's ENABLE ROW LEVEL SECURITY text would still satisfy the gate
-- while the live table sat unprotected.

DELETE FROM global_person_claim_tokens;

-- Dropping `token` drops the primary key with it; re-key on a surrogate id.
-- Both ADDs rely on the table having just been emptied (NOT NULL + PK).
ALTER TABLE global_person_claim_tokens DROP COLUMN IF EXISTS token;
ALTER TABLE global_person_claim_tokens
  ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid();
ALTER TABLE global_person_claim_tokens
  ADD COLUMN IF NOT EXISTS token_hash TEXT NOT NULL UNIQUE;

NOTIFY pgrst, 'reload schema';
