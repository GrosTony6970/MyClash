/**
 * Part of check 25 of the RLS probe (`team-tables-probe.mjs` runs it): a Tournament keeps its kind
 * once it has a phase (migration 0288, ruling 989), and a team Tournament takes no double
 * elimination and no Swiss phase (migration 0289, rulings 996 and 1007).
 *
 * Each write runs AS THE OWNER in a savepoint rolled back, on a new Tournament of the published
 * Event that each case makes, with no entrant and no League link: `entrant_kind_is_settled` (0281)
 * and `league_link_blocks_team` (0287), the other checks of a change of kind, hold, so the phase
 * check is the first to fail. A refusal is matched by the name the trigger raises with, so a write
 * refused for another reason is a failure too. Refused: the switch to team of an individual
 * Tournament with a bracket phase, and the switch to individual of a team Tournament with a Pool
 * phase; a double elimination and a Swiss phase on a team Tournament, and a team Tournament's
 * single elimination phase changed to double elimination. Taken: the switch of a Tournament whose
 * only phase was deleted; a single elimination and a Pool phase on a team Tournament; a double
 * elimination and a Swiss phase on an individual one. The races of a phase and a switch need two
 * connections on committed rows: the cascade probe runs them (`team-kind-race.mjs`).
 */

import { errorOf, OPEN } from './match-rules-probe-kit.mjs';

/** A new Tournament of `kind` of the published Event, with no entrant, and a phase of `type`. */
async function phased(sp, kind, type) {
  const [{ id }] = await sp`INSERT INTO tournaments (event_id, slug, name, status, entrant_kind)
                            VALUES (${OPEN}, 'phase-kind-probe', 'Phase kind', 'draft', ${kind})
                            RETURNING id`;
  const [{ id: phase }] = await sp`INSERT INTO phases (tournament_id, type)
                                   VALUES (${id}, ${type}) RETURNING id`;
  return { id, phase };
}

/** The Tournament switched to `kind`; throws when the kind did not change. */
async function switchTo(sp, id, kind) {
  await sp`UPDATE tournaments SET entrant_kind = ${kind} WHERE id = ${id}`;
  const [{ now }] = await sp`SELECT entrant_kind AS now FROM tournaments WHERE id = ${id}`;
  if (now !== kind) throw new Error('the kind did not change');
}

/** The phase's type changed to `type`; throws when it did not change. */
async function retype(sp, phase, type) {
  await sp`UPDATE phases SET type = ${type} WHERE id = ${phase}`;
  const [{ now }] = await sp`SELECT type AS now FROM phases WHERE id = ${phase}`;
  if (now !== type) throw new Error('the type did not change');
}

const FITS = 'phase_fits_entrant_kind';

const CASES = [
  {
    what: 'the switch to team of a Tournament with a bracket phase and no entrant',
    refusedBy: 'entrant_kind_set_before_phases',
    write: async (sp) => switchTo(sp, (await phased(sp, 'individual', 'double_elim')).id, 'team'),
  },
  {
    what: 'the switch to individual of a team Tournament with a Pool phase and no entrant',
    refusedBy: 'entrant_kind_set_before_phases',
    write: async (sp) => switchTo(sp, (await phased(sp, 'team', 'pool')).id, 'individual'),
  },
  {
    what: 'the switch to team of a Tournament whose only phase was deleted',
    refusedBy: null,
    write: async (sp) => {
      const { id, phase } = await phased(sp, 'individual', 'single_elim');
      await sp`DELETE FROM phases WHERE id = ${phase}`;
      await switchTo(sp, id, 'team');
    },
  },
  {
    what: 'a double elimination phase on a team Tournament',
    refusedBy: FITS,
    write: (sp) => phased(sp, 'team', 'double_elim'),
  },
  {
    what: 'a Swiss phase on a team Tournament',
    refusedBy: FITS,
    write: (sp) => phased(sp, 'team', 'swiss'),
  },
  {
    what: "a team Tournament's single elimination phase changed to double elimination",
    refusedBy: FITS,
    write: async (sp) => retype(sp, (await phased(sp, 'team', 'single_elim')).phase, 'double_elim'),
  },
  {
    what: 'a single elimination phase on a team Tournament',
    refusedBy: null,
    write: (sp) => phased(sp, 'team', 'single_elim'),
  },
  {
    what: 'a Pool phase on a team Tournament',
    refusedBy: null,
    write: (sp) => phased(sp, 'team', 'pool'),
  },
  {
    what: 'a double elimination phase on an individual Tournament',
    refusedBy: null,
    write: (sp) => phased(sp, 'individual', 'double_elim'),
  },
  {
    what: 'a Swiss phase on an individual Tournament',
    refusedBy: null,
    write: (sp) => phased(sp, 'individual', 'swiss'),
  },
];

/** What is wrong, as sentences; none when all is right. */
export async function teamKindPhaseFailures(tx) {
  const failures = [];
  for (const { what, refusedBy, write } of CASES) {
    const error = await errorOf(tx, write);
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
