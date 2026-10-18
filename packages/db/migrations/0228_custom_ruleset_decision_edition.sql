-- 0228: a club formula ruleset keeps the end decision of the day it was published.
--
-- THE DEFECT. Every built-in version names the end decision it runs (its `decisionEdition`), so a
-- bout fought before the decision changed and corrected after it is decided as it was fought
-- (operator ruling "TF_v1 version", 2026-10-16). A club formula ruleset had none of its own: the
-- API built it with today's decision, whatever day it was published. When the shared decision
-- moves again (as on 2026-10-11, both fighters at zero in a bout that counts down), every club
-- formula and every bout already fought under one would be decided again by the new rule, and
-- nothing would say so. Rulings "Club formulas" (2026-10-17: freeze per snapshot) and "Edition
-- day" (the day it is published fixes its end rule).
--
-- WHAT CHANGES. `decision_edition` on `custom_rulesets` and on `custom_ruleset_versions`: nullable,
-- no default, one of the known editions (`DECISION_EDITIONS` in @myclash/rules; a db test pins the
-- two lists together). On `custom_rulesets` a row that is neither a built-in's mirror (`is_system`)
-- nor a coded fork (`base_code`, whose edition is its base engine's) must hold one: the resolver
-- reads it for those rows only. A snapshot copies its row's edition when it is taken; a coded
-- fork's snapshot holds none.
-- Rows stored before this take '2026-10', the edition the API gave every one of them until now, so
-- nothing they score moves. From now on the API writes it: today's edition when a row is created,
-- and again when a version is published, unless that version is already in use.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy or grant change: only the API's service role writes either table (0225).

alter table custom_rulesets add column decision_edition text;
alter table custom_ruleset_versions add column decision_edition text;

update custom_rulesets
  set decision_edition = '2026-10'
  where base_code is null and not is_system;

update custom_ruleset_versions v
  set decision_edition = '2026-10'
  from custom_rulesets r
  where r.id = v.custom_ruleset_id and r.base_code is null and not r.is_system;

alter table custom_rulesets
  add constraint custom_rulesets_decision_edition_known
    check (decision_edition in ('2026-04', '2026-10')),
  add constraint custom_rulesets_decision_edition_required
    check (base_code is not null or is_system or decision_edition is not null);

alter table custom_ruleset_versions
  add constraint custom_ruleset_versions_decision_edition_known
    check (decision_edition in ('2026-04', '2026-10'));
