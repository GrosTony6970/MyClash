/**
 * Part of check 11 of the RLS probe (`match-rules-probe.mjs`): a bout's rules live only in its
 * copy (migration 0232). No bout is without a copy, whoever writes it; the row's own engine
 * columns and the backfill that read them are gone; and a club ruleset version a bout holds, by
 * its copy or, while it is not started, by one it held before, is held (ruling M "Draft lock"):
 * the edit guard keeps it as it is. A copy no bout holds does not count; a copy that says "1"
 * names 1.0.0, as the row builder writes it.
 */

import {
  BOUT,
  CLUB_SCORING,
  PHASE,
  SECOND,
  TOURNAMENT,
  errorOf,
  isolated,
  stamp,
} from './match-rules-probe-kit.mjs';

export async function onlyCopyFailures(tx, failures) {
  const refused = await errorOf(
    tx,
    (sp) => sp`INSERT INTO matches (id, phase_id) VALUES (${SECOND}, ${PHASE})`,
  );
  if (refused?.code !== '23502')
    failures.push(`a bout with no copy was written (${refused?.message ?? 'no error'})`);
  const [{ left }] = await tx`
    SELECT count(*)::int AS left FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'matches'
      AND column_name IN ('ruleset_code', 'ruleset_version', 'ruleset_content_hash')`;
  if (left !== 0) failures.push(`a bout row still carries ${left} of its old engine columns`);
  const [{ backfill }] =
    await tx`SELECT to_regprocedure('public.backfill_match_rules()') AS backfill`;
  if (backfill !== null) failures.push('the backfill that read the old engine columns is there');
}

export async function heldPairFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const heldNow = async (version = '1.0.0') =>
      (await sp`SELECT public.ruleset_pair_held_by_a_bout(${CLUB_SCORING}, ${version}) AS held`)[0]
        .held;
    await sp`SELECT public.build_match_rules(${TOURNAMENT}, ${CLUB_SCORING}, '1.0.0', 'no-bout')`;
    if (await heldNow())
      failures.push('a ruleset version only a copy no bout holds names was held');
    await sp`UPDATE tournaments SET ruleset_code = ${CLUB_SCORING}, ruleset_version = '1.0.0'
             WHERE id = ${TOURNAMENT}`;
    await stamp(sp);
    if (!(await heldNow())) failures.push("a ruleset version a bout's copy names was not held");
    await sp`UPDATE tournaments SET ruleset_code = 'TF_v1', ruleset_version = '1.1.0'
             WHERE id = ${TOURNAMENT}`;
    await stamp(sp);
    if (!(await heldNow()))
      failures.push('a ruleset version a not-started bout held before was not held');
    if (await heldNow('9.9.9')) failures.push('another version of the ruleset was held');
    await sp`UPDATE matches SET status = 'running' WHERE id = ${BOUT}`;
    if (await heldNow()) failures.push('a ruleset version a started bout held before was held');
  });
  await isolated(tx, async (sp) => {
    const [{ id }] = await sp`
      INSERT INTO match_rules (tournament_id, ruleset_code, ruleset_version, ruleset_config,
                               scoring_config_json, digest)
      VALUES (${TOURNAMENT}, ${CLUB_SCORING}, '1', '{}', '{}', 'probe-version-one') RETURNING id`;
    await sp`UPDATE matches SET match_rules_id = ${id} WHERE id = ${BOUT}`;
    const [{ held }] =
      await sp`SELECT public.ruleset_pair_held_by_a_bout(${CLUB_SCORING}, '1.0.0') AS held`;
    if (!held) failures.push('a copy that says version "1" did not hold 1.0.0');
  });
}
