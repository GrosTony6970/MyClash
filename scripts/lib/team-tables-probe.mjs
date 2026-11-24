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
 */

import { errorOf, OPEN, TOURNAMENT } from './match-rules-probe-kit.mjs';

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

/** What is wrong, as sentences; none when all is right. */
export async function teamTablesFailures(tx) {
  const failures = [];
  for (const { what, refusedBy, write } of CASES) {
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
