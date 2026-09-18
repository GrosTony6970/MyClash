import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  filtersFor,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import {
  EVENT,
  LICE,
  TOURNAMENT,
  alerts,
  at,
  makeService,
  poolMatch,
  seed,
  sheet,
} from './match-placement.fixtures';

/**
 * The one owner of putting a Match on a piste, on the seeded double, running
 * `resolveMatchLengths` for real — because what is being asserted here IS the
 * length reaching the collision test. A doubled helper would let a five-minute
 * assumption back in without a red test. A typed length reaching that test is
 * `match-placement.override.test.ts`; the seeded tables are shared through
 * `match-placement.fixtures.ts`.
 */

beforeEach(() => {
  alerts.refresh.mockClear();
});

describe('MatchPlacementService.placeMatches', () => {
  it('writes the piste, the time and the timestamp, and refreshes once', async () => {
    const { service, supabase } = makeService(seed());

    await service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: at('10:00') }]);

    const write = writesTo(supabase, 'matches')[0];
    expect(write?.row).toMatchObject({ lice_id: LICE, scheduled_at: at('10:00') });
    expect(scopedTo(write, 'id')).toBe('m-1');
    expect(alerts.refresh).toHaveBeenCalledExactlyOnceWith(['m-1']);
  });

  it('leaves a stored override alone unless the caller names one', async () => {
    const { service, supabase } = makeService(seed());

    await service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: at('10:00') }]);

    expect(writesTo(supabase, 'matches')[0]?.row).not.toHaveProperty(
      'planned_duration_override_minutes',
    );
  });

  it('reads nothing at all for a batch of clears', async () => {
    // Releasing a strip cannot collide with anything, so neither the sheet nor
    // the occupants are read — one query, and it is the write.
    const { service, supabase } = makeService(seed());

    await service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: null, scheduledAt: null }]);

    expect(queriedTables(supabase.from)).toEqual(['matches']);
    expect(writesTo(supabase, 'matches')[0]?.row).toMatchObject({
      lice_id: null,
      scheduled_at: null,
    });
  });

  it('lets two back-to-back bouts share a piste at the sheet length', async () => {
    // Seven-minute pool bouts: 10:00 ends exactly as 10:07 begins. Touching is
    // not overlapping, or every generated schedule would refuse itself.
    const { service } = makeService(
      seed({
        event_programme_configs: sheet({ poolMatchDurationMinutes: 7 }),
        matches: {
          rows: [poolMatch('m-1'), poolMatch('occ', { lice_id: LICE, scheduled_at: at('10:00') })],
        },
      }),
    );

    await expect(
      service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: at('10:07') }]),
    ).resolves.toBeUndefined();
  });

  it("refuses a drop inside another bout's window, and writes nothing", async () => {
    const { service, supabase } = makeService(
      seed({
        event_programme_configs: sheet({ poolMatchDurationMinutes: 7 }),
        matches: {
          rows: [poolMatch('m-1'), poolMatch('occ', { lice_id: LICE, scheduled_at: at('10:00') })],
        },
      }),
    );

    await expect(
      service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: at('10:06') }]),
    ).rejects.toThrow(/Piste already busy/);
    expect(supabase.writes).toEqual([]);
    expect(alerts.refresh).not.toHaveBeenCalled();
  });

  it('refuses a re-drop in place once the sheet outgrows the stride', async () => {
    // ADR-017. The bouts sit five minutes apart and the organiser has since
    // typed eight-minute pool bouts, so the run no longer fits where it is.
    // Nothing moved; the sheet is being believed.
    const { service } = makeService(
      seed({
        event_programme_configs: sheet({ poolMatchDurationMinutes: 8 }),
        matches: {
          rows: [
            poolMatch('m-1', { lice_id: LICE, scheduled_at: at('10:00') }),
            poolMatch('m-2', { lice_id: LICE, scheduled_at: at('10:05') }),
          ],
        },
      }),
    );

    await expect(
      service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: at('10:00') }]),
    ).rejects.toThrow(/Piste already busy/);
  });

  it("checks a batch's rows against each OTHER, not only against the strip", async () => {
    // An outward-only check would land two of the same batch on one slot.
    const { service, supabase } = makeService(
      seed({ matches: { rows: [poolMatch('m-1'), poolMatch('m-2')] } }),
    );

    await expect(
      service.placeMatches(EVENT, [
        { matchId: 'm-1', liceId: LICE, scheduledAt: at('10:00') },
        { matchId: 'm-2', liceId: LICE, scheduledAt: at('10:02') },
      ]),
    ).rejects.toThrow(/Piste already busy/);
    expect(supabase.writes).toEqual([]);
  });

  it('never collides a batch with where its own rows already sit', async () => {
    // The batch's ids are dropped from the occupant list; otherwise every
    // re-save of a Pool refuses itself.
    const { service, supabase } = makeService(
      seed({
        matches: {
          rows: [
            poolMatch('m-1', { lice_id: LICE, scheduled_at: at('10:00') }),
            poolMatch('m-2', { lice_id: LICE, scheduled_at: at('10:05') }),
          ],
        },
      }),
    );

    await service.placeMatches(EVENT, [
      { matchId: 'm-1', liceId: LICE, scheduledAt: at('10:05') },
      { matchId: 'm-2', liceId: LICE, scheduledAt: at('10:10') },
    ]);

    expect(writesTo(supabase, 'matches')).toHaveLength(2);
    expect(alerts.refresh).toHaveBeenCalledExactlyOnceWith(['m-1', 'm-2']);
  });

  it('reads a batch of 201 bouts in two pieces, and still finds a missing one', async () => {
    // The board's batch can name more bouts than one URL holds. A read of the
    // first piece alone would call every later bout missing.
    const ids = Array.from({ length: 201 }, (_, n) => `m-${n}`);
    const batch = ids.map((matchId, n) => ({
      matchId,
      liceId: LICE,
      scheduledAt: new Date(Date.parse(at('08:00')) + n * 5 * 60_000).toISOString(),
    }));
    const { service, supabase } = makeService(
      seed({ matches: { rows: ids.map((id) => poolMatch(id)) } }),
    );

    await service.placeMatches(EVENT, batch);

    expect(
      filtersFor(supabase.from, 'matches', 'in').filter(([column]) => column === 'id'),
    ).toEqual([
      ['id', ids.slice(0, 200)],
      ['id', ids.slice(200)],
    ]);
    expect(writesTo(supabase, 'matches')).toHaveLength(201);

    const shortOne = makeService(
      seed({ matches: { rows: ids.slice(0, 200).map((id) => poolMatch(id)) } }),
    );
    await expect(shortOne.service.placeMatches(EVENT, batch)).rejects.toThrow(
      new NotFoundException('Match m-200 not found'),
    );
  });

  it('asks the occupant read for the columns a length needs, and skips voided bouts', async () => {
    const { service, supabase } = makeService(
      seed({
        matches: {
          rows: [
            poolMatch('m-1'),
            poolMatch('cancelled', {
              lice_id: LICE,
              scheduled_at: at('10:00'),
              status: 'voided',
            }),
          ],
        },
      }),
    );

    await service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: at('10:00') }]);

    expect(selectsFor(supabase.from, 'matches')).toContain(
      'id, phase_id, lice_id, scheduled_at, planned_duration_override_minutes',
    );
    expect(filtersFor(supabase.from, 'matches', 'not')).toEqual(
      expect.arrayContaining([
        ['scheduled_at', 'is', null],
        ['status', 'eq', 'voided'],
      ]),
    );
  });

  it('sees a bracket bout holding the strip, at the bracket length', async () => {
    // `reschedulePool` used to read occupants with `.neq('pool_id', poolId)`.
    // In Postgres that is NULL for a bracket or Swiss bout, which is not TRUE,
    // so those rows never came back and a Pool could be dropped straight on top
    // of a final. The occupant read is scoped by piste alone now, and the bout
    // is measured at its own kind: an 8-minute elimination bout from 10:00
    // still holds the strip at 10:07.
    const { service } = makeService(
      seed({
        phases: {
          rows: [
            { id: 'phase-pool', type: 'pool', tournament_id: TOURNAMENT },
            { id: 'phase-bracket', type: 'single_elim', tournament_id: TOURNAMENT },
          ],
        },
        matches: {
          rows: [
            poolMatch('m-1'),
            {
              id: 'quarter',
              phase_id: 'phase-bracket',
              lice_id: LICE,
              scheduled_at: at('10:00'),
              status: 'scheduled',
              planned_duration_override_minutes: null,
              bracket_slot_id: 'slot-quarter',
              bracket_slots: { round: 1 },
            },
          ],
        },
      }),
    );

    await expect(
      service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: at('10:07') }]),
    ).rejects.toThrow(/Piste already busy/);
  });

  it("refuses another Event's Lice on a piste-only assignment, with no time", async () => {
    // "Assign the pistes now, fix the clock after" is a real half-step, and it
    // names a Lice like any other. Scoping the Event check to placements that
    // also carry a time left `createMatch` — whose `scheduledAt` is optional —
    // with no check at all, and migration 0197's trigger answering in raw
    // Postgres instead of a sentence an organiser can read.
    const { service, supabase } = makeService(seed());

    await expect(
      service.placeMatches(EVENT, [
        { matchId: 'm-1', liceId: 'lice-elsewhere', scheduledAt: null },
      ]),
    ).rejects.toThrow('Every Lice must belong to this event');
    expect(supabase.writes).toEqual([]);
  });

  it('writes a piste-only assignment once its Lice is this Event’s', async () => {
    const { service, supabase } = makeService(seed());

    await service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: null }]);

    expect(writesTo(supabase, 'matches')[0]?.row).toMatchObject({
      lice_id: LICE,
      scheduled_at: null,
    });
    // No time means no window, so nothing is read about occupancy.
    expect(queriedTables(supabase.from)).toEqual(['lices', 'matches']);
  });

  it("refuses another Event's Lice before it reads a single Match", async () => {
    const { service, supabase } = makeService(seed());

    await expect(
      service.placeMatches(EVENT, [
        { matchId: 'm-1', liceId: 'lice-elsewhere', scheduledAt: at('10:00') },
      ]),
    ).rejects.toThrow('Every Lice must belong to this event');
    expect(queriedTables(supabase.from)).toEqual(['lices']);
  });

  it('refuses a time it cannot read, with a 400 rather than a scrubbed 500', async () => {
    // The assistant hands over `String(action['scheduledAt'])` unvalidated, and
    // `matchWindowMs` throws a RangeError on a start it cannot parse.
    const { service, supabase } = makeService(seed());

    await expect(
      service.placeMatches(EVENT, [{ matchId: 'm-1', liceId: LICE, scheduledAt: 'tomorrow-ish' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('refuses a Match that does not exist', async () => {
    const { service } = makeService(seed());

    await expect(
      service.placeMatches(EVENT, [{ matchId: 'ghost', liceId: LICE, scheduledAt: at('10:00') }]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checkOnly reports and writes nothing', async () => {
    const { service, supabase } = makeService(
      seed({
        matches: {
          rows: [poolMatch('m-1'), poolMatch('occ', { lice_id: LICE, scheduled_at: at('10:00') })],
        },
      }),
    );

    await expect(
      service.placeMatches(
        EVENT,
        [{ matchId: null, liceId: LICE, scheduledAt: at('10:02'), phaseId: 'phase-pool' }],
        { checkOnly: true },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(supabase.writes).toEqual([]);
  });

  it('checkOnly accepts a free strip and still writes nothing', async () => {
    const { service, supabase } = makeService(seed());

    await service.placeMatches(
      EVENT,
      [{ matchId: null, liceId: LICE, scheduledAt: at('10:00'), phaseId: 'phase-pool' }],
      { checkOnly: true },
    );

    expect(supabase.writes).toEqual([]);
    expect(alerts.refresh).not.toHaveBeenCalled();
  });

  it('refreshes what committed and reports the row the database refused', async () => {
    // `Promise.all` would leave the rows before the rejection written and every
    // alert stale. The database explains itself in the message — 0197's trigger
    // on a foreign Lice, 0196's CHECK on a planned length — so it is carried out.
    //
    // A canned QUEUE for `matches`, not a seeded table: the seeded double has no
    // way to fail a write, and failing one is the whole case. The order is the
    // service's own: the batch read, the occupant read, then one update per row.
    const { service, supabase } = makeService({
      ...seed(),
      matches: [
        { data: [poolMatch('m-1'), poolMatch('m-2')], error: null },
        { data: [], error: null },
        { data: null, error: null },
        { data: null, error: { message: 'matches_planned_duration_check' } },
      ],
    });

    await expect(
      service.placeMatches(EVENT, [
        { matchId: 'm-1', liceId: LICE, scheduledAt: at('10:00') },
        { matchId: 'm-2', liceId: LICE, scheduledAt: at('10:20') },
      ]),
    ).rejects.toThrow(/matches_planned_duration_check/);

    // The row that landed still moved, so its fighters' alerts are refreshed
    // before the throw — and the one that did not is left out.
    expect(alerts.refresh).toHaveBeenCalledExactlyOnceWith(['m-1']);
    expect(writesTo(supabase, 'matches')).toHaveLength(2);
  });
});
