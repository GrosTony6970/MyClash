/**
 * `publiclyKnownProfileIds` asked for MANY profiles at once: a league's standings ask for every
 * ranked fighter (quick win F21). Until then its callers asked for one profile, or for a hundred.
 *
 * Two limits of PostgREST then matter. A `.in()` list is read from the URL, so a long one fails
 * the read (`IN_LIST_MAX`). And a read is cut at 1000 rows with no word (`PGRST_DB_MAX_ROWS`): a
 * profile whose roster rows were cut would look like one with no roster row, and count as known.
 * That is the wrong side to fail on. Its page is hidden, and its address would leave the server.
 *
 * Every profile here is on the roster of a DRAFT Event only, so the public may know none of them,
 * except the one an account has claimed.
 */
import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase } from '../testing/supabase-chain';
import { IN_LIST_MAX } from '../postgrest-in-list';
import { publiclyKnownProfileIds } from './hidden-entrants';

const DRAFT_EVENT = {
  id: 'e-draft',
  status: 'draft',
  organization_id: 'org-a',
  event_kind: 'standard',
};

const profile = (id: string, claimed = false) => ({
  id,
  claimed_by_user_id: claimed ? 'u-1' : null,
  made_outside_roster: false,
});

const rosterRows = (profileId: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p-${profileId}-${index}`,
    event_id: DRAFT_EVENT.id,
    global_person_id: profileId,
  }));

function build(
  profiles: Array<ReturnType<typeof profile>>,
  persons: Array<Record<string, unknown>>,
) {
  const db = mockSupabase({
    global_persons: { rows: profiles },
    persons: { rows: persons },
    events: { rows: [DRAFT_EVENT] },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
  });
  return { db, deps: { supabase: { service: db.service } } as never };
}

const listsOf = (db: ReturnType<typeof mockSupabase>, table: string) =>
  filtersFor(db.from, table, 'in').map(([, list]) => list as string[]);

describe('publiclyKnownProfileIds, asked for many profiles', () => {
  const MANY = Array.from({ length: 2 * IN_LIST_MAX + 50 }, (_, index) => `gp-${index}`);

  it('asks in pieces no longer than a .in() list may be, and answers for all of them', async () => {
    const claimed = MANY[MANY.length - 1]!;
    const { db, deps } = build(
      MANY.map((id) => profile(id, id === claimed)),
      MANY.flatMap((id) => rosterRows(id, 1)),
    );

    const known = await publiclyKnownProfileIds(deps, MANY);

    // The one profile of the last piece that stands on its own, and no hidden one.
    expect([...known]).toEqual([claimed]);
    for (const table of ['global_persons', 'persons', 'event_referees', 'event_instructors']) {
      const lists = listsOf(db, table);
      expect(lists.length, table).toBeGreaterThan(0);
      for (const list of lists) expect(list.length, table).toBeLessThanOrEqual(IN_LIST_MAX);
    }
    expect(listsOf(db, 'global_persons').flat()).toEqual(MANY);
  });

  it('asks once for a profile named several times', async () => {
    const { db, deps } = build([profile('gp-a')], rosterRows('gp-a', 1));

    await publiclyKnownProfileIds(deps, ['gp-a', 'gp-a', 'gp-a']);

    expect(listsOf(db, 'global_persons')).toEqual([['gp-a']]);
  });
});

describe('publiclyKnownProfileIds, when a roster read comes back full', () => {
  it('reads the profiles again in two halves: a full read may have been cut', async () => {
    const { db, deps } = build(
      [profile('gp-a'), profile('gp-b')],
      [...rosterRows('gp-a', 600), ...rosterRows('gp-b', 400)],
    );

    const known = await publiclyKnownProfileIds(deps, ['gp-a', 'gp-b']);

    expect([...known]).toEqual([]);
    expect(listsOf(db, 'persons')).toEqual([['gp-a', 'gp-b'], ['gp-a'], ['gp-b']]);
  });

  it('reads once when the read is not full', async () => {
    const { db, deps } = build(
      [profile('gp-a'), profile('gp-b')],
      [...rosterRows('gp-a', 600), ...rosterRows('gp-b', 399)],
    );

    await publiclyKnownProfileIds(deps, ['gp-a', 'gp-b']);

    expect(listsOf(db, 'persons')).toEqual([['gp-a', 'gp-b']]);
  });

  it('fails loudly for one profile whose own read is full: never "known" on a cut read', async () => {
    const { deps } = build([profile('gp-a')], rosterRows('gp-a', 1000));

    await expect(publiclyKnownProfileIds(deps, ['gp-a'])).rejects.toThrow(
      /^profile roster read failed: one profile fills a whole read$/,
    );
  });
});
