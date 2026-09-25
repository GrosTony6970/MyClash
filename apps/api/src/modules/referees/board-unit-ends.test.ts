import { describe, expect, it } from 'vitest';
import { buildScheduleBlocks } from '@myclash/schedule-core';
import {
  finishBoardUnits,
  lengthInputsOf,
  type DraftBoardUnit,
  type DraftUnitMatch,
} from './board-unit-ends';

function bout(id: string, scheduledAt: string | null, over: Partial<DraftUnitMatch> = {}) {
  return {
    id,
    scheduledAt,
    liceId: 'lice-1',
    redRegistrationId: `${id}-red`,
    blueRegistrationId: `${id}-blue`,
    phaseId: 'phase-1',
    plannedDurationOverrideMinutes: null,
    ...over,
  };
}

function unit(id: string, matches: DraftUnitMatch[]): DraftBoardUnit {
  return {
    id,
    name: id,
    tournamentId: 't-1',
    tournamentName: 'Longsword',
    liceId: 'lice-1',
    kind: 'pool',
    members: [],
    matches,
    roleSlots: [],
  };
}

describe('finishBoardUnits', () => {
  it("gives every bout its own resolved length and every unit its hull's end", () => {
    const [finished] = finishBoardUnits(
      [
        unit('pool-1', [
          bout('m1', '2026-08-01T09:00:00.000Z'),
          bout('m2', '2026-08-01T09:08:00.000Z'),
        ]),
      ],
      new Map([
        ['m1', 8],
        ['m2', 12],
      ]),
    );

    expect(finished!.matches.map((m) => [m.id, m.durationMinutes])).toEqual([
      ['m1', 8],
      ['m2', 12],
    ]);
    expect(finished!.scheduledEnd).toBe('2026-08-01T09:20:00.000Z');
  });

  it('starts every unit at its earliest bout by the clock, not by the text of its time', () => {
    // 09:00+02:00 is 07:00 UTC: earlier than 08:30Z, although it sorts after it as text.
    const [finished] = finishBoardUnits(
      [
        unit('pool-1', [
          bout('m1', '2026-08-01T08:30:00+00:00'),
          bout('m2', '2026-08-01T09:00:00+02:00'),
        ]),
      ],
      new Map([
        ['m1', 10],
        ['m2', 10],
      ]),
    );
    expect(finished!.scheduledStart).toBe('2026-08-01T07:00:00.000Z');
    expect(finished!.scheduledEnd).toBe('2026-08-01T08:40:00.000Z');
  });

  it('gives a unit nobody placed neither end', () => {
    const [finished] = finishBoardUnits([unit('pool-1', [bout('m1', null)])], new Map([['m1', 8]]));
    expect(finished!.scheduledStart).toBeNull();
    expect(finished!.scheduledEnd).toBeNull();
  });

  it("keeps the helper's inputs off the board's bouts", () => {
    const [finished] = finishBoardUnits([unit('pool-1', [bout('m1', null)])], new Map([['m1', 5]]));

    expect(finished!.matches[0]).toEqual({
      id: 'm1',
      scheduledAt: null,
      liceId: 'lice-1',
      redRegistrationId: 'm1-red',
      blueRegistrationId: 'm1-blue',
      durationMinutes: 5,
    });
  });

  it('throws for a bout whose length was not resolved', () => {
    expect(() =>
      finishBoardUnits([unit('pool-1', [bout('m1', '2026-08-01T09:00:00.000Z')])], new Map()),
    ).toThrow('No planned length for match m1');
  });
});

describe('lengthInputsOf', () => {
  it('hands the helper every bout of every unit, with its phase and its own override', () => {
    expect(
      lengthInputsOf([
        unit('pool-1', [bout('m1', null), bout('m2', null, { plannedDurationOverrideMinutes: 9 })]),
        unit('match-m3', [bout('m3', null, { phaseId: 'phase-2' })]),
      ]),
    ).toEqual([
      { id: 'm1', phaseId: 'phase-1', plannedDurationOverrideMinutes: null },
      { id: 'm2', phaseId: 'phase-1', plannedDurationOverrideMinutes: 9 },
      { id: 'm3', phaseId: 'phase-2', plannedDurationOverrideMinutes: null },
    ]);
  });
});

/**
 * The board and the grid must agree on when a Pool ends: the board decides when
 * its crew is free, the grid draws the Pool's bar. Same rows, same lengths.
 */
describe('the referee board and the schedule grid', () => {
  it('end a Pool at the same instant', () => {
    // The bout that ends last (m4) neither starts last nor sits last in the list,
    // so only the hull reads 09:25: the last start plus its length says 09:23.
    const rows = [
      { id: 'm4', scheduledAt: '2026-08-01T09:05:00.000Z', minutes: 20 },
      { id: 'm1', scheduledAt: '2026-08-01T09:00:00.000Z', minutes: 12 },
      { id: 'm2', scheduledAt: '2026-08-01T09:09:00.000Z', minutes: 7 },
      { id: 'm3', scheduledAt: '2026-08-01T09:16:00.000Z', minutes: 7 },
    ];
    const lengths = new Map(rows.map((r) => [r.id, r.minutes]));

    const [boardUnit] = finishBoardUnits(
      [
        unit(
          'pool-1',
          rows.map((r) => bout(r.id, r.scheduledAt)),
        ),
      ],
      lengths,
    );
    const [gridBlock] = buildScheduleBlocks(
      rows.map((r) => ({
        id: r.id,
        liceId: 'lice-1',
        scheduledAt: r.scheduledAt,
        poolId: 'pool-1',
        poolName: 'Pool 1',
        phaseType: 'pool',
        tournamentName: 'Longsword',
        redFighterName: null,
        blueFighterName: null,
        durationMinutes: r.minutes,
      })),
    );

    expect(boardUnit!.scheduledEnd).toBe('2026-08-01T09:25:00.000Z');
    expect(boardUnit!.scheduledEnd).toBe(gridBlock!.endIso);
  });
});
