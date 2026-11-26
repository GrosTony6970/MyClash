/**
 * Part of check 25 of the RLS probe (`team-tables-probe.mjs` runs it): a Tournament keeps its kind
 * once it has a phase (migration 0288, ruling 983).
 *
 * Each write runs AS THE OWNER in a savepoint rolled back, on a new Tournament of the published
 * Event that each case makes, with no entrant and no League link: `entrant_kind_is_settled` (0281)
 * and `league_link_blocks_team` (0287), the other checks of a change of kind, hold, so the phase
 * check is the first to fail. A refusal is matched by the name the trigger raises with, so a write
 * refused for another reason is a failure too. Refused: the switch to team of an individual
 * Tournament with a bracket phase, and the switch to individual of a team Tournament with a Pool
 * phase. Taken: the switch of a Tournament whose only phase was deleted. The race of a phase and a
 * switch needs two connections on committed rows: the cascade probe runs it (`team-kind-race.mjs`).
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
