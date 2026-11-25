/**
 * Part of check 25 of the RLS probe (`team-tables-probe.mjs` runs it): `fighter_blow_value_stats`
 * as migration 0285 left it.
 *
 * - A team bout of the seed's team Tournament, with Exchanges, adds no row. Before 0285 the function
 *   grouped the bout's empty Registration side and gave one all-zero row per point value.
 * - An individual bout of the seed's individual Tournament, with an Exchange, still gives its
 *   Fighter's row.
 * - Neither `anon` nor `authenticated` may run the function: no GRANT, and 0275 left it to
 *   `service_role`.
 * Each bout is written in a savepoint rolled back.
 */

import { BOUT, isolated, TOURNAMENT } from './match-rules-probe-kit.mjs';

const TEAM_TOURNAMENT = '77777777-0000-4000-8000-00000000007a';
const TEAM = '7ea00000-0000-4000-8000-00000000000a';
// The seed's Registration of the individual Tournament: Probe Fighter (rls-probe-seed.sql).
const REGISTRATION = 'cccccccc-0000-4000-8000-00000000000a';
const FUNCTION = 'fighter_blow_value_stats(uuid)';

/** Two clean blows, one worth 1 and one worth 2, both struck by red, on `matchId`. The seed's bout
 * holds Exchanges of its own, so the sequences are well past them. */
async function blows(sp, matchId) {
  for (const [sequence, value] of [
    [901, 1],
    [902, 2],
  ]) {
    await sp`INSERT INTO exchanges (client_uuid, match_id, sequence, type, occurred_at,
                                    first_striker_color, first_strike_value)
             VALUES (${crypto.randomUUID()}, ${matchId}, ${sequence}, 'clean', now(), 'red', ${value})`;
  }
}

const rowsOf = (sp, tournament) =>
  sp`SELECT registration_id, point_value, hits_given FROM fighter_blow_value_stats(${tournament})`;

/** What is wrong, as sentences; none when all is right. */
export async function teamBlowStatsFailures(tx) {
  const failures = [];

  await isolated(tx, async (sp) => {
    const [{ id: phase }] = await sp`INSERT INTO phases (tournament_id, type)
                                     VALUES (${TEAM_TOURNAMENT}, 'pool') RETURNING id`;
    const [{ id: copy }] =
      await sp`INSERT INTO match_rules (tournament_id, ruleset_code, ruleset_version, ruleset_config,
                                        scoring_config_json, digest)
               VALUES (${TEAM_TOURNAMENT}, 'TF_v1', '1.1.0', '{}', '{}', 'team-blows')
               RETURNING id`;
    const [{ id: rival }] = await sp`INSERT INTO teams (tournament_id, name, slug, size)
                                     VALUES (${TEAM_TOURNAMENT}, 'Blow team', 'blow-team', 3)
                                     RETURNING id`;
    const [{ id: bout }] = await sp`INSERT INTO matches (phase_id, match_rules_id, red_team_id,
                                                         blue_team_id)
                                    VALUES (${phase}, ${copy}, ${rival}, ${TEAM}) RETURNING id`;
    await blows(sp, bout);
    const rows = await rowsOf(sp, TEAM_TOURNAMENT);
    if (rows.length > 0) {
      failures.push(`check 25: a team bout adds ${JSON.stringify(rows)} to the blow-value stats`);
    }
  });

  await isolated(tx, async (sp) => {
    await sp`UPDATE matches SET red_registration_id = ${REGISTRATION} WHERE id = ${BOUT}`;
    const hits = async () => {
      const rows = (await rowsOf(sp, TOURNAMENT)).filter((r) => r.registration_id === REGISTRATION);
      return Object.fromEntries(rows.map((r) => [r.point_value, Number(r.hits_given)]));
    };
    const before = await hits();
    await blows(sp, BOUT);
    const after = await hits();
    if (after[1] !== (before[1] ?? 0) + 1 || after[2] !== (before[2] ?? 0) + 1) {
      failures.push(
        `check 25: an individual bout reads ${JSON.stringify(after)} (was ${JSON.stringify(before)}) in the blow-value stats`,
      );
    }
  });

  for (const role of ['anon', 'authenticated']) {
    const [{ may }] =
      await tx`SELECT has_function_privilege(${role}, ${FUNCTION}, 'EXECUTE') AS may`;
    if (may) failures.push(`check 25: ${role} may run ${FUNCTION}`);
  }
  return failures;
}
