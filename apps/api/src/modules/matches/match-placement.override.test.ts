import { beforeEach, describe, expect, it } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import { EVENT, LICE, alerts, at, makeService, poolMatch, seed } from './match-placement.fixtures';

/**
 * A typed bout length reaching the piste check (ADR-018).
 *
 * The run window hands the placement owner new starts together with the NEW
 * length. The strip must be judged at that length, not at the one still stored
 * on the row — or a run growing from 5 to 7 minutes is checked at 5 and written
 * at 7. On the seeded double, with `resolveMatchLengths` running for real.
 */

beforeEach(() => {
  alerts.refresh.mockClear();
});

const SIX = ['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6'];
const minutesPast10 = (minutes: number) => at(`10:${String(minutes).padStart(2, '0')}`);

/** Six pool bouts back to back on one piste at the sheet's 5 minutes, from 10:00. */
const fiveMinuteRun = () =>
  SIX.map((id, index) => poolMatch(id, { lice_id: LICE, scheduled_at: minutesPast10(index * 5) }));

describe('MatchPlacementService.placeMatches — a typed bout length', () => {
  it('lets six bouts grow from 5 to 7 minutes in one batch, and writes 7 on each', async () => {
    const { service, supabase } = makeService(seed({ matches: { rows: fiveMinuteRun() } }));

    await service.placeMatches(
      EVENT,
      SIX.map((id, index) => ({
        matchId: id,
        liceId: LICE,
        scheduledAt: minutesPast10(index * 7),
        plannedDurationOverrideMinutes: 7,
      })),
    );

    const written = writesTo(supabase, 'matches');
    expect(written).toHaveLength(6);
    const lengths = written.map(
      (write) => (write.row as Record<string, unknown>)['planned_duration_override_minutes'],
    );
    expect(lengths).toEqual([7, 7, 7, 7, 7, 7]);
  });

  it('refuses one of those bouts alone at 7 minutes, against a neighbour that has not moved', async () => {
    // The pair of the case above. m-3 at 10:10 grows to 7 minutes while m-4
    // still starts at 10:15, so [10:10, 10:17) overlaps it. At the stored 5
    // minutes the two only touch: this refusal is the check reading the NEW length.
    const { service, supabase } = makeService(seed({ matches: { rows: fiveMinuteRun() } }));

    await expect(
      service.placeMatches(EVENT, [
        {
          matchId: 'm-3',
          liceId: LICE,
          scheduledAt: minutesPast10(10),
          plannedDurationOverrideMinutes: 7,
        },
      ]),
    ).rejects.toThrow(/Piste already busy/);
    expect(supabase.writes).toEqual([]);
  });

  it('refuses a batch that types 7 minutes but keeps the 5-minute stride', async () => {
    // Batch members are checked against each other, at the length being written.
    const { service, supabase } = makeService(seed({ matches: { rows: fiveMinuteRun() } }));

    await expect(
      service.placeMatches(
        EVENT,
        SIX.map((id, index) => ({
          matchId: id,
          liceId: LICE,
          scheduledAt: minutesPast10(index * 5),
          plannedDurationOverrideMinutes: 7,
        })),
      ),
    ).rejects.toThrow(/Piste already busy/);
    expect(supabase.writes).toEqual([]);
  });

  it("measures a cleared length at the sheet's, and writes null", async () => {
    // m-1 carries a stored 9 minutes and m-2 starts at 10:05, so at 9 minutes
    // m-1 would overlap it. Clearing hands the length back to the sheet's 5.
    const { service, supabase } = makeService(
      seed({
        matches: {
          rows: [
            poolMatch('m-1', {
              lice_id: LICE,
              scheduled_at: minutesPast10(0),
              planned_duration_override_minutes: 9,
            }),
            poolMatch('m-2', { lice_id: LICE, scheduled_at: minutesPast10(5) }),
          ],
        },
      }),
    );

    await service.placeMatches(EVENT, [
      {
        matchId: 'm-1',
        liceId: LICE,
        scheduledAt: minutesPast10(0),
        plannedDurationOverrideMinutes: null,
      },
    ]);

    expect(writesTo(supabase, 'matches')[0]?.row).toMatchObject({
      planned_duration_override_minutes: null,
    });
  });
});
