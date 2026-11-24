/**
 * Part of check 25 of the RLS probe (`team-tables-probe.mjs` runs it): `vw_tournament_query_matches`
 * as migration 0284 left it.
 *
 * - The view runs as its caller (`security_invoker=on`): a CREATE OR REPLACE without it drops it
 *   silently, as 0193 did (0202).
 * - A team bout of the seed's team Tournament reads each team's name, id and colour name, and the
 *   winner team; no Registration and no club.
 * - The seed's individual bout, given its Fighter on red, still reads the Person's name and no
 *   team.
 * Each bout is written in a savepoint rolled back.
 */

import { BOUT, isolated, same } from './match-rules-probe-kit.mjs';

const TEAM_TOURNAMENT = '77777777-0000-4000-8000-00000000007a';
const TEAM = '7ea00000-0000-4000-8000-00000000000a';
// The seed's Registration of the individual Tournament: Probe Fighter (rls-probe-seed.sql).
const REGISTRATION = 'cccccccc-0000-4000-8000-00000000000a';

const COLUMNS = (sp, matchId) =>
  sp`SELECT red_name, blue_name, red_club, blue_club, red_registration_id, blue_registration_id,
            red_team_id, blue_team_id, winner_team_id, red_team_color, blue_team_color
       FROM vw_tournament_query_matches WHERE match_id = ${matchId}`;

/** A team bout of the team Tournament: the seed's team in blue against a new one in red. */
async function teamBoutRow(sp) {
  const [{ id: phase }] = await sp`INSERT INTO phases (tournament_id, type)
                                   VALUES (${TEAM_TOURNAMENT}, 'pool') RETURNING id`;
  const [{ id: copy }] =
    await sp`INSERT INTO match_rules (tournament_id, ruleset_code, ruleset_version, ruleset_config,
                                      scoring_config_json, digest)
             VALUES (${TEAM_TOURNAMENT}, 'TF_v1', '1.1.0', '{}', '{}', 'team-view')
             RETURNING id`;
  const [{ id: rival }] = await sp`INSERT INTO teams (tournament_id, name, slug, size, color)
                                   VALUES (${TEAM_TOURNAMENT}, 'Lyon Blades', 'lyon-blades', 3,
                                           'green')
                                   RETURNING id`;
  await sp`UPDATE teams SET color = 'violet' WHERE id = ${TEAM}`;
  const [{ id: bout }] = await sp`INSERT INTO matches (phase_id, match_rules_id, red_team_id,
                                                       blue_team_id, winner_team_id)
                                  VALUES (${phase}, ${copy}, ${rival}, ${TEAM}, ${rival})
                                  RETURNING id`;
  const [row] = await COLUMNS(sp, bout);
  return { row, rival };
}

/** What is wrong, as sentences; none when all is right. */
export async function teamViewFailures(tx) {
  const failures = [];
  const [{ options }] = await tx`SELECT coalesce(reloptions, '{}') AS options FROM pg_class
                                 WHERE oid = 'public.vw_tournament_query_matches'::regclass`;
  if (!options.includes('security_invoker=on')) {
    failures.push(`check 25: vw_tournament_query_matches runs as its owner (${options})`);
  }

  await isolated(tx, async (sp) => {
    const { row, rival } = await teamBoutRow(sp);
    const want = {
      red_name: 'Lyon Blades',
      blue_name: 'Probe team',
      red_club: null,
      blue_club: null,
      red_registration_id: null,
      blue_registration_id: null,
      red_team_id: rival,
      blue_team_id: TEAM,
      winner_team_id: rival,
      red_team_color: 'green',
      blue_team_color: 'violet',
    };
    if (!same(row, want)) {
      failures.push(`check 25: a team bout reads ${JSON.stringify(row)} in the view`);
    }
  });

  await isolated(tx, async (sp) => {
    await sp`UPDATE matches SET red_registration_id = ${REGISTRATION} WHERE id = ${BOUT}`;
    const [row] = await COLUMNS(sp, BOUT);
    if (row?.red_name !== 'Probe Fighter' || row.red_team_id !== null || row.blue_name !== null) {
      failures.push(`check 25: an individual bout reads ${JSON.stringify(row)} in the view`);
    }
  });
  return failures;
}
