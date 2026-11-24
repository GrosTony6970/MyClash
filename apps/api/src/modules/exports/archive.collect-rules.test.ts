import { describe, expect, it, vi } from 'vitest';
import { rowsForRules, type RuleEnv, type RuleFetchers } from './archive.service';
import type { ArchiveRow, CollectRule } from './archive.table-spec';

/**
 * A made-up list over a made-up database: no table in the registry is collected through a list
 * yet (Task 4's `team_slots` entry is the first), so the test hands the rules in itself.
 */
const PERSONS: ArchiveRow[] = [
  { id: 'p1', event_id: 'e1' },
  { id: 'p2', event_id: 'e1' },
  { id: 'p3', event_id: 'e1' },
];

const THROUGH_REGISTRATIONS: CollectRule = {
  from: 'registrations',
  local: 'id',
  parent: 'person_id',
};
const THROUGH_SLOTS: CollectRule = { from: 'team_slots', local: 'id', parent: 'person_id' };

function setup(include: 'structure' | 'scoring' = 'structure') {
  const parents: Record<string, ArchiveRow[]> = {
    registrations: [
      { id: 'r1', person_id: 'p1' },
      { id: 'r2', person_id: 'p2' },
    ],
    team_slots: [
      { id: 's1', person_id: 'p2' },
      { id: 's2', person_id: 'p3' },
    ],
  };
  const listRowsByIds = vi.fn(async (_table: string, column: string, values: unknown[]) =>
    PERSONS.filter((row) => values.includes(row[column])),
  );
  const fetch: RuleFetchers = {
    listRows: vi.fn(async () => []),
    listRowsByIds: listRowsByIds as never,
  };
  const env: RuleEnv = {
    include,
    eventId: 'e1',
    roots: {},
    resolve: async (table) => parents[table] ?? [],
    context: { eventId: 'e1', tournamentIds: [], idsOf: () => [] },
  };
  return { fetch, env, listRowsByIds };
}

describe('collecting a table through two parents', () => {
  it('gives the union of both parents, each id once', async () => {
    const { fetch, env, listRowsByIds } = setup();

    const rows = await rowsForRules('persons', [THROUGH_REGISTRATIONS, THROUGH_SLOTS], env, fetch);

    expect(rows.map((row) => row['id']).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(listRowsByIds).toHaveBeenCalledTimes(2);
    expect(listRowsByIds).toHaveBeenCalledWith('persons', 'id', ['p1', 'p2']);
    expect(listRowsByIds).toHaveBeenCalledWith('persons', 'id', ['p2', 'p3']);
  });

  it('gives what the rule gives alone for a list of one', async () => {
    const { fetch, env } = setup();

    const listed = await rowsForRules('persons', [THROUGH_SLOTS], env, fetch);
    const single = await rowsForRules('persons', THROUGH_SLOTS, env, fetch);

    expect(listed).toEqual(single);
    expect(listed.map((row) => row['id'])).toEqual(['p2', 'p3']);
  });

  it('collects nothing for a scoring list in a structure-only archive', async () => {
    const { fetch, env } = setup('structure');
    const scoring = (rule: CollectRule): CollectRule => ({ ...rule, include: 'scoring' });

    const rows = await rowsForRules(
      'persons',
      [scoring(THROUGH_REGISTRATIONS), scoring(THROUGH_SLOTS)],
      env,
      fetch,
    );

    expect(rows).toEqual([]);
  });
});
