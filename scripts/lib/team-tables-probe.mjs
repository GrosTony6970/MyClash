/**
 * Check 25 of the RLS probe (`scripts/db-rls-probe.mjs`): a Tournament's kind and its teams'
 * slots hold (migration 0281, team Tournaments).
 *
 * Each write runs AS THE OWNER (0247 leaves no web role a write on these tables) in a savepoint
 * rolled back, on the seed's published team Tournament, its team and its captain's slot, and on the
 * seed's individual Tournament with its Registrations. A refusal is matched by the name of the
 * constraint or index, or by the name the kind trigger raises with: a write refused for another
 * reason is a failure too. Refused: a second live slot for one Person in one Tournament, a second
 * captain, a captain with no Person, a slot with neither seat nor Person, a team of 11, a
 * Tournament whose teams start at 11, a Registration in a team Tournament and a Team in an
 * individual one, a change of kind of a Tournament that holds a Registration or a Team. Taken, at
 * the operator's boundaries: an empty seat, a reserve, a team of 10, a change of kind of a
 * Tournament with no entrant, and a save that sends a Tournament's own kind again although it
 * holds entrants.
 *
 * The team twins of the side links (migration 0282), on a phase, a copy of the rules, a Pool and a
 * second team each case builds in its savepoint. Refused, each by its check: a row that names both
 * a Registration and a Team for one side, on each table; a Pool member, a card, a protest or a
 * forfeit with neither; the same team twice in one Pool; a Match with a Registration on one side
 * and a Team on the other; a team Match with a winner Registration; a team forfeit with a winner
 * Registration; a draw that names a winner Team. Taken: a team win on a forfeit that is not a draw.
 *
 * And the index on each key that names a team (migration 0283, `team-key-indexes-probe.mjs`), and
 * the view of bouts that names a team side (migration 0284, `team-view-probe.mjs`), and the blow
 * stats that leave a team bout out (migration 0285, `team-blow-stats-probe.mjs`), and a League that
 * takes individual Tournaments only (migration 0287, `team-league-probe.mjs`). The kind trigger's
 * race and the League link's need two connections on committed rows: the cascade probe runs them
 * (`team-kind-race.mjs`).
 */

import { errorOf, OPEN, TOURNAMENT } from './match-rules-probe-kit.mjs';
import { teamBlowStatsFailures } from './team-blow-stats-probe.mjs';
import { teamKeyIndexFailures } from './team-key-indexes-probe.mjs';
import { teamLeagueFailures } from './team-league-probe.mjs';
import { teamViewFailures } from './team-view-probe.mjs';

// The seed's published team Tournament, its team and the two Fighters of the published Event
// (rls-probe-seed.sql). The first holds the team's captain slot.
const TEAM_TOURNAMENT = '77777777-0000-4000-8000-00000000007a';
const TEAM = '7ea00000-0000-4000-8000-00000000000a';
const CAPTAIN = 'bbbbbbbb-0000-4000-8000-00000000000a';
const OTHER = 'b0f00000-0000-4000-8000-00000000000a';

const slot = (sp, { team = TEAM, position, person, captain = false }) =>
  sp`INSERT INTO team_slots (team_id, tournament_id, position, person_id, is_captain)
     VALUES (${team}, ${TEAM_TOURNAMENT}, ${position}, ${person}, ${captain})`;

const kindOf = async (sp, id) =>
  (await sp`SELECT entrant_kind FROM tournaments WHERE id = ${id}`)[0].entrant_kind;

const CASES = [
  {
    what: 'a second slot for one Person in one Tournament',
    refusedBy: 'team_slots_one_team_per_person',
    write: async (sp) => {
      const [{ id }] = await sp`INSERT INTO teams (tournament_id, name, slug, size)
                                VALUES (${TEAM_TOURNAMENT}, 'Second team', 'second-team', 3)
                                RETURNING id`;
      await slot(sp, { team: id, position: 1, person: CAPTAIN });
    },
  },
  {
    what: 'a second captain',
    refusedBy: 'team_slots_one_captain',
    write: (sp) => slot(sp, { position: 2, person: OTHER, captain: true }),
  },
  {
    what: 'a captain with no Person',
    refusedBy: 'team_slots_captain_is_named',
    write: (sp) => slot(sp, { position: 2, person: null, captain: true }),
  },
  {
    what: 'a slot with no seat and no Person',
    refusedBy: 'team_slots_seat_or_reserve',
    write: (sp) => slot(sp, { position: null, person: null }),
  },
  {
    what: 'a team of 11',
    refusedBy: 'teams_size_range',
    write: (sp) => sp`INSERT INTO teams (tournament_id, name, slug, size)
                      VALUES (${TEAM_TOURNAMENT}, 'Big team', 'big-team', 11)`,
  },
  {
    what: 'a Tournament whose teams start at 11',
    refusedBy: 'tournaments_team_default_size_range',
    write: (sp) => sp`INSERT INTO tournaments (event_id, slug, name, status, team_default_size)
                      VALUES (${OPEN}, 'size-probe', 'Size probe', 'draft', 11)`,
  },
  {
    what: 'an empty seat',
    refusedBy: null,
    write: (sp) => slot(sp, { position: 2, person: null }),
  },
  {
    what: 'a reserve',
    refusedBy: null,
    write: (sp) => slot(sp, { position: null, person: OTHER }),
  },
  {
    what: 'a team of 10',
    refusedBy: null,
    write: (sp) => sp`INSERT INTO teams (tournament_id, name, slug, size)
                      VALUES (${TEAM_TOURNAMENT}, 'Full team', 'full-team', 10)`,
  },
  {
    what: 'a Registration in a team Tournament',
    refusedBy: 'entrant_kind_holds',
    write: (sp) => sp`INSERT INTO registrations (tournament_id, person_id)
                      VALUES (${TEAM_TOURNAMENT}, ${OTHER})`,
  },
  {
    what: 'a Team in an individual Tournament',
    refusedBy: 'entrant_kind_holds',
    write: (sp) => sp`INSERT INTO teams (tournament_id, name, slug, size)
                      VALUES (${TOURNAMENT}, 'Probe team', 'probe-team', 3)`,
  },
  {
    what: 'a change of kind of a Tournament with a Registration',
    refusedBy: 'entrant_kind_is_settled',
    write: (sp) => sp`UPDATE tournaments SET entrant_kind = 'team' WHERE id = ${TOURNAMENT}`,
  },
  {
    what: 'a change of kind of a Tournament with a Team',
    refusedBy: 'entrant_kind_is_settled',
    write: (sp) =>
      sp`UPDATE tournaments SET entrant_kind = 'individual' WHERE id = ${TEAM_TOURNAMENT}`,
  },
  {
    what: 'a change of kind of a Tournament with no entrant',
    refusedBy: null,
    write: async (sp) => {
      const [{ id }] = await sp`INSERT INTO tournaments (event_id, slug, name, status)
                                VALUES (${OPEN}, 'kind-probe', 'Kind probe', 'draft')
                                RETURNING id`;
      await sp`UPDATE tournaments SET entrant_kind = 'team' WHERE id = ${id}`;
      if ((await kindOf(sp, id)) !== 'team') throw new Error('the kind did not change');
    },
  },
  {
    what: 'the same kind sent again to a Tournament with a Team',
    refusedBy: null,
    write: (sp) => sp`UPDATE tournaments SET entrant_kind = 'team' WHERE id = ${TEAM_TOURNAMENT}`,
  },
];

// A Registration of the seed's individual Tournament (forfeit-draw-probe.mjs's Fighter who forfeits).
const REGISTRATION = 'cccccccc-0000-4000-8000-00000000000a';

/** A phase, a copy of the rules, a Pool and a second team of the team Tournament: the seed has none. */
async function teamStage(sp) {
  const [{ id: phase }] = await sp`INSERT INTO phases (tournament_id, type)
                                   VALUES (${TEAM_TOURNAMENT}, 'pool') RETURNING id`;
  const [{ id: copy }] =
    await sp`INSERT INTO match_rules (tournament_id, ruleset_code, ruleset_version, ruleset_config,
                                      scoring_config_json, digest)
             VALUES (${TEAM_TOURNAMENT}, 'TF_v1', '1.1.0', '{}', '{}', 'team-twins')
             RETURNING id`;
  const [{ id: pool }] =
    await sp`INSERT INTO pools (phase_id, name) VALUES (${phase}, 'A') RETURNING id`;
  const [{ id: rival }] = await sp`INSERT INTO teams (tournament_id, name, slug, size)
                                   VALUES (${TEAM_TOURNAMENT}, 'Rival team', 'rival-team', 3)
                                   RETURNING id`;
  return { phase, copy, pool, rival };
}

/** A Match of the stage with the side columns `sides` names; its id. */
async function match(sp, stage, sides) {
  const row = { phase_id: stage.phase, match_rules_id: stage.copy, pool_id: stage.pool, ...sides };
  return (await sp`INSERT INTO matches ${sp(row)} RETURNING id`)[0].id;
}

/** A Match of the seed's team against the stage's rival: a team Match. */
const teamMatch = (sp, stage) => match(sp, stage, { red_team_id: TEAM, blue_team_id: stage.rival });

/** A forfeit of a team Match with the columns `row` names. */
async function forfeit(sp, row) {
  const stage = await teamStage(sp);
  const matchId = await teamMatch(sp, stage);
  const full = {
    match_id: matchId,
    tournament_id: TEAM_TOURNAMENT,
    reason: 'injury',
    ...row(stage),
  };
  await sp`INSERT INTO match_forfeits ${sp(full)}`;
}

/** A card or a protest of a team Match naming `side`. */
async function sheetEntry(sp, table, side) {
  const matchId = await teamMatch(sp, await teamStage(sp));
  const card = table === 'match_penalties' ? { card: 'yellow' } : {};
  const row = {
    client_uuid: crypto.randomUUID(),
    match_id: matchId,
    tournament_id: TEAM_TOURNAMENT,
    sequence: 1,
    occurred_at: new Date(),
    ...card,
    ...side,
  };
  await sp`INSERT INTO ${sp(table)} ${sp(row)}`;
}

/** A member of a new Pool of the team Tournament naming `side`. */
async function poolMember(sp, side) {
  const { pool } = await teamStage(sp);
  await sp`INSERT INTO pool_members ${sp({ pool_id: pool, ...side })}`;
}

/** A slot of a new phase of the team Tournament naming `side`. */
async function bracketSlot(sp, side) {
  const { phase } = await teamStage(sp);
  await sp`INSERT INTO bracket_slots ${sp({ phase_id: phase, round: 1, position: 1, ...side })}`;
}

/**
 * The team twins of the side links (0282). Postgres tests a row's checks in name order and reports
 * the first that fails, so each refused row holds only the fault its case names: the named check
 * is the first of its table to fail.
 */
const TWIN_CASES = [
  {
    what: 'a Pool member with a Registration and a Team',
    refusedBy: 'pool_members_one_entrant',
    write: (sp) => poolMember(sp, { registration_id: REGISTRATION, team_id: TEAM }),
  },
  {
    what: 'a Pool member with neither',
    refusedBy: 'pool_members_one_entrant',
    write: (sp) => poolMember(sp, {}),
  },
  {
    what: 'the same team twice in one Pool',
    refusedBy: 'pool_members_pool_team_key',
    write: async (sp) => {
      const { pool } = await teamStage(sp);
      await sp`INSERT INTO pool_members (pool_id, team_id) VALUES (${pool}, ${TEAM})`;
      await sp`INSERT INTO pool_members (pool_id, team_id) VALUES (${pool}, ${TEAM})`;
    },
  },
  {
    what: 'a bracket slot with a Registration and a Team on side A',
    refusedBy: 'bracket_slots_a_one_kind',
    write: (sp) => bracketSlot(sp, { registration_a_id: REGISTRATION, team_a_id: TEAM }),
  },
  {
    what: 'a bracket slot with a Registration and a Team on side B',
    refusedBy: 'bracket_slots_b_one_kind',
    write: (sp) => bracketSlot(sp, { registration_b_id: REGISTRATION, team_b_id: TEAM }),
  },
  {
    what: 'a Match with a Registration and a Team red',
    refusedBy: 'matches_red_one_kind',
    write: async (sp) =>
      match(sp, await teamStage(sp), { red_registration_id: REGISTRATION, red_team_id: TEAM }),
  },
  {
    what: 'a Match with a Registration and a Team blue',
    refusedBy: 'matches_blue_one_kind',
    write: async (sp) =>
      match(sp, await teamStage(sp), { blue_registration_id: REGISTRATION, blue_team_id: TEAM }),
  },
  {
    // No side, so `matches_winner_same_kind`, after it by name, has nothing to refuse.
    what: 'a Match with no side and two winners, a Registration and a Team',
    refusedBy: 'matches_winner_one_kind',
    write: async (sp) =>
      match(sp, await teamStage(sp), {
        winner_registration_id: REGISTRATION,
        winner_team_id: TEAM,
      }),
  },
  {
    what: 'a Match with a Registration red and a Team blue',
    refusedBy: 'matches_sides_same_kind',
    write: async (sp) =>
      match(sp, await teamStage(sp), { red_registration_id: REGISTRATION, blue_team_id: TEAM }),
  },
  {
    what: 'a team Match with a winner Registration',
    refusedBy: 'matches_winner_same_kind',
    write: async (sp) => {
      const stage = await teamStage(sp);
      await match(sp, stage, {
        red_team_id: TEAM,
        blue_team_id: stage.rival,
        winner_registration_id: REGISTRATION,
      });
    },
  },
  {
    what: 'a card for a Registration and a Team',
    refusedBy: 'match_penalties_one_side',
    write: (sp) =>
      sheetEntry(sp, 'match_penalties', { registration_id: REGISTRATION, team_id: TEAM }),
  },
  {
    what: 'a protest for a Registration and a Team',
    refusedBy: 'match_protests_one_side',
    write: (sp) =>
      sheetEntry(sp, 'match_protests', { registration_id: REGISTRATION, team_id: TEAM }),
  },
  {
    what: 'a protest for neither',
    refusedBy: 'match_protests_one_side',
    write: (sp) => sheetEntry(sp, 'match_protests', {}),
  },
  {
    // A yellow card, so `match_penalties_card_check`, first by name, holds.
    what: 'a card for neither',
    refusedBy: 'match_penalties_one_side',
    write: (sp) => sheetEntry(sp, 'match_penalties', {}),
  },
  {
    // A loss with its winner, so `match_forfeits_draw_has_no_winner`, first by name, holds, and
    // no Fighter outcome, so `match_forfeits_fighter_outcome_allowed` holds.
    what: 'a forfeit by neither',
    refusedBy: 'match_forfeits_forfeiting_one_kind',
    write: (sp) =>
      forfeit(sp, (stage) => ({ winner_team_id: stage.rival, score_policy: 'fixed_loss' })),
  },
  {
    // A loss with its winner, so `match_forfeits_draw_has_no_winner`, first by name, holds.
    what: 'a forfeit by a Registration and a Team',
    refusedBy: 'match_forfeits_forfeiting_one_kind',
    write: (sp) =>
      forfeit(sp, (stage) => ({
        forfeiting_registration_id: REGISTRATION,
        forfeiting_team_id: TEAM,
        winner_team_id: stage.rival,
        score_policy: 'fixed_loss',
      })),
  },
  {
    what: 'a team win on a forfeit that is not a draw',
    refusedBy: null,
    write: (sp) =>
      forfeit(sp, (stage) => ({
        forfeiting_team_id: TEAM,
        winner_team_id: stage.rival,
        score_policy: 'fixed_loss',
      })),
  },
  {
    what: 'a draw on a team forfeit that names a winner Team',
    refusedBy: 'match_forfeits_draw_has_no_winner',
    write: (sp) =>
      forfeit(sp, (stage) => ({
        forfeiting_team_id: TEAM,
        winner_team_id: stage.rival,
        score_policy: 'draw',
      })),
  },
  {
    what: 'a team forfeit with a winner Registration',
    refusedBy: 'match_forfeits_same_kind',
    write: (sp) =>
      forfeit(sp, () => ({
        forfeiting_team_id: TEAM,
        winner_registration_id: REGISTRATION,
        score_policy: 'fixed_loss',
      })),
  },
];

/** What is wrong, as sentences; none when all is right. */
export async function teamTablesFailures(tx) {
  const failures = [
    ...(await teamKeyIndexFailures(tx)),
    ...(await teamViewFailures(tx)),
    ...(await teamBlowStatsFailures(tx)),
    ...(await teamLeagueFailures(tx)),
  ];
  for (const { what, refusedBy, write } of [...CASES, ...TWIN_CASES]) {
    const error = await errorOf(tx, async (sp) => {
      await write(sp);
      // The slot's Person key is checked at commit (0281, as 0237): forced here, in the savepoint.
      await sp`SET CONSTRAINTS ALL IMMEDIATE`;
    });
    if (!refusedBy && error) {
      failures.push(`check 25: ${what} is refused: ${error.message}`);
    } else if (refusedBy && error?.constraint_name !== refusedBy) {
      failures.push(
        `check 25: ${what} is not refused by ${refusedBy} (${error ? error.message : 'taken'})`,
      );
    }
  }
  return failures;
}
