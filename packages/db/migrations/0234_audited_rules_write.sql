-- 0234: an audited change of a Tournament's rules is written in one step that checks what it read.
--
-- THE DEFECT. The re-pin ceremony (the API's `repinTournamentRuleset`) reads a Tournament, works
-- out the new rules, and then writes in separate steps: the Tournament, the record of the change
-- (`tournament_ruleset_repins`, 0150), its hash and the stamp of the bouts not started. Nothing
-- checks that the Tournament still holds what the organiser read: two organisers who confirm on
-- the same screen both succeed, and the second record describes a change from rules that were
-- already gone. A record that fails to write leaves the Tournament on new rules with no record.
-- And the record names only a ruleset move: an audited change of the settings themselves (the
-- audited settings change slice) has no place in it.
--
-- WHAT CHANGES.
--   1. The record gains `kind` ('ruleset', a move to another ruleset or version; 'settings', a
--      change of the settings of the same one), `config_before` and `config_after` (the rules
--      settings each side, `{ rulesetConfig, scoringConfig }`; NULL on the records made before
--      0234), and `changes` (each changed rules setting, before and after, as the API's
--      `scoringDiff` lists them). `placings_after` loses NOT NULL and its default: the API fills
--      it after the write, from the record's id, and "not filled yet" is not "no placings".
--   2. `repin_tournament_rules(p_tournament_id, p_expected, p_next, p_audit)` is the one write of
--      an audited change, in one transaction. It locks the Tournament's row (`for no key update`,
--      as the stamp does) and compares six columns with what the API read (`p_expected`): the
--      ruleset pair, its two settings, and the card pin. Each column is compared raw, as JSON, SQL
--      NULL read as JSON null: a version "1" equals "1" and not "1.0.0". Any difference refuses
--      with `rules_changed_since_read` and writes nothing. Else it writes the Tournament's rules
--      (`p_next`; a JSON null setting is stored as SQL NULL, as every other writer leaves it),
--      the record (`p_audit`, under the Event of the locked row, never one the caller names),
--      stamps the bouts not started (0232's `stamp_match_rules`) and answers the record's id.
-- THE RACE. Two audited changes from one read: the second waits on the first's row lock, then
-- reads the row the first wrote, and is refused. A plain settings save of the API that lands
-- between the read and the call changes a compared column, so the call is refused, never the
-- save lost. A bout that starts before the stamp keeps the copy it had (0232).
-- Applied files are never edited: the record's "written once" (0150, line 7, "append-only";
-- 0227, line 5, "the API writes it once") is now "written once, and its `placings_after` filled
-- once after".
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table: the record keeps its policies (0150, 0227: readers only; anon and authenticated
-- have no write grant). The function is SECURITY INVOKER: the API calls it as the service role,
-- and since 0233 no other role may write a Tournament. search_path pinned. EXECUTE revoked from
-- public, anon and authenticated BY NAME (the image grants the two roles by name, 0190's header)
-- and granted to the service role.

alter table public.tournament_ruleset_repins
  add column kind text not null default 'ruleset' check (kind in ('ruleset', 'settings')),
  add column config_before jsonb,
  add column config_after jsonb,
  add column changes jsonb not null default '[]'::jsonb,
  alter column placings_after drop not null,
  alter column placings_after drop default;

comment on table public.tournament_ruleset_repins is
  'The record of each audited change of a Tournament''s rules: a ruleset move or a settings change, its reason and changes, and the placings around it. Written once by repin_tournament_rules; placings_after is filled once after.';

create or replace function public.repin_tournament_rules(
  p_tournament_id uuid,
  p_expected jsonb,
  p_next jsonb,
  p_audit jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  t record;
  v_id uuid;
begin
  select tr.event_id, tr.ruleset_code, tr.ruleset_version, tr.ruleset_config,
         tr.scoring_config_json, tr.penalty_ruleset_id, tr.penalty_ruleset_version
    into t
    from public.tournaments tr
    where tr.id = p_tournament_id
    for no key update;
  if not found then
    raise exception 'Tournament % was not found', p_tournament_id
      using errcode = 'P0002';
  end if;
  if not (
    coalesce(to_jsonb(t.ruleset_code), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'ruleset_code', 'null'::jsonb)
    and coalesce(to_jsonb(t.ruleset_version), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'ruleset_version', 'null'::jsonb)
    and coalesce(to_jsonb(t.ruleset_config), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'ruleset_config', 'null'::jsonb)
    and coalesce(to_jsonb(t.scoring_config_json), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'scoring_config_json', 'null'::jsonb)
    and coalesce(to_jsonb(t.penalty_ruleset_id), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'penalty_ruleset_id', 'null'::jsonb)
    and coalesce(to_jsonb(t.penalty_ruleset_version), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'penalty_ruleset_version', 'null'::jsonb)
  ) then
    raise exception 'rules_changed_since_read' using errcode = 'P0001';
  end if;
  update public.tournaments
    set ruleset_code = p_next->>'ruleset_code',
        ruleset_version = p_next->>'ruleset_version',
        ruleset_config = nullif(p_next->'ruleset_config', 'null'::jsonb),
        scoring_config_json = nullif(p_next->'scoring_config_json', 'null'::jsonb),
        ruleset_content_hash = p_next->>'ruleset_content_hash',
        updated_at = now()
    where id = p_tournament_id;
  insert into public.tournament_ruleset_repins (
    event_id, tournament_id, actor_user_id, kind, from_code, from_version, to_code, to_version,
    justification, bucket_diff, ranking_compatible, placings_before, config_before, config_after,
    changes
  ) values (
    t.event_id,
    p_tournament_id,
    (p_audit->>'actor_user_id')::uuid,
    p_audit->>'kind',
    p_audit->>'from_code',
    p_audit->>'from_version',
    p_audit->>'to_code',
    p_audit->>'to_version',
    p_audit->>'justification',
    p_audit->'bucket_diff',
    (p_audit->>'ranking_compatible')::boolean,
    p_audit->'placings_before',
    p_audit->'config_before',
    p_audit->'config_after',
    p_audit->'changes'
  )
  returning id into v_id;
  perform public.stamp_match_rules(p_tournament_id);
  return v_id;
end;
$$;

comment on function public.repin_tournament_rules(uuid, jsonb, jsonb, jsonb) is
  'An audited change of a Tournament''s rules: refuses rules_changed_since_read unless the row still holds p_expected, else writes p_next, records p_audit, stamps the bouts not started and answers the record id.';

revoke execute on function public.repin_tournament_rules(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.repin_tournament_rules(uuid, jsonb, jsonb, jsonb) to service_role;

NOTIFY pgrst, 'reload schema';
