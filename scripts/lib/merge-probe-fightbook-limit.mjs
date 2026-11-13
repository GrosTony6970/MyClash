/**
 * What a fighter merge does to the FightBook daily limit (migration 0271, the slice 6 plan's
 * Decision 5): the survivor keeps the stricter limit, as it keeps the stricter switches (0265,
 * 0268). The merged profile's own row stays where nothing reads it; a revert touches neither row.
 * Each case is one scenario and one check, so a run before 0271 fails each case by name.
 */
import { P, lastMerge, merge, revert, scenarioCheck } from './merge-probe-fixture.mjs';

const setLimit = (q, profile, n, updatedAt = '2020-01-01T00:00:00Z') =>
  q`INSERT INTO fightbook_daily_limits (global_person_id, daily_limit, updated_at)
    VALUES (${profile}, ${n}, ${updatedAt})`;

const limitOf = (q, profile) =>
  q`SELECT daily_limit FROM fightbook_daily_limits WHERE global_person_id = ${profile}`.then(
    (rows) => rows[0]?.daily_limit ?? null,
  );

/** The survivor's limit and the merged profile's, after a merge with these two limits. */
async function merged(q, survivor, mergedAway) {
  if (survivor !== null) await setLimit(q, P.target, survivor);
  if (mergedAway !== null) await setLimit(q, P.source, mergedAway);
  await merge(q, P.source, P.target);
  return [await limitOf(q, P.target), await limitOf(q, P.source)];
}

export async function dailyLimitMovesWithTheMerge(tx) {
  await scenarioCheck(
    tx,
    'a survivor with no limit takes the merged profile’s, which keeps its own row',
    [3, 3],
    (q) => merged(q, null, 3),
  );
  await scenarioCheck(tx, 'a survivor at 3 merged with 5 keeps 3', [3, 5], (q) => merged(q, 3, 5));
  await scenarioCheck(tx, 'neither has a limit: no row', [null, null], (q) =>
    merged(q, null, null),
  );
  await scenarioCheck(
    tx,
    'a survivor at 5 merged with 3 takes 3, written now; a revert leaves both rows as they are',
    [
      [3, 3, true],
      [3, 3],
    ],
    async (q) => {
      const after = await merged(q, 5, 3);
      const [{ now }] = await q`SELECT updated_at = now() AS now FROM fightbook_daily_limits
        WHERE global_person_id = ${P.target}`;
      await revert(q, (await lastMerge(q, P.source)).id);
      return [
        [...after, now],
        [await limitOf(q, P.target), await limitOf(q, P.source)],
      ];
    },
  );
}
