-- MCP slice 4b, call S (ruling 989): a draft that Claude saves through MyClash's MCP server is
-- `source = 'mcp'`, beside the form's `form` and the chat's `chat`.
--
-- 0116 declared the CHECK inline, so Postgres named it
-- organizer_ai_assistant_drafts_source_check. It is dropped by that name, and the widened one
-- gets a name of its own: after a replay, the old name must be gone and one source CHECK left.
-- No IF EXISTS: a wrong name must fail the replay, not leave the old CHECK beside the new one.
-- The table stays closed to every web role (no read rule since 0273).

ALTER TABLE organizer_ai_assistant_drafts
  DROP CONSTRAINT organizer_ai_assistant_drafts_source_check;

ALTER TABLE organizer_ai_assistant_drafts
  ADD CONSTRAINT organizer_ai_assistant_drafts_source_allowed
  CHECK (source IN ('form', 'chat', 'mcp'));
