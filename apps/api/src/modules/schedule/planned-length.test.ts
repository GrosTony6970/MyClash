import { describe, expect, it } from 'vitest';
import type { SuggestConfig } from '@myclash/types';
import { PROGRAMME_CONFIG_DEFAULTS } from '../programme/dto/programme.dto';
import {
  finalRoundOf,
  isFinalsMatch,
  matchKind,
  plannedEndIso,
  plannedLengthOf,
  sheetLengthFor,
  sheetRestFor,
  type MatchKind,
} from './planned-length';

const LONGSWORD = 'longsword';
const SABRE = 'sabre';

function sheet(over: Partial<SuggestConfig> = {}): SuggestConfig {
  return { ...PROGRAMME_CONFIG_DEFAULTS, ...over };
}

describe('sheetRestFor', () => {
  it("reads the Event's rest when the Tournament has no row", () => {
    expect(sheetRestFor(sheet({ minRestMinutes: 12 }), LONGSWORD)).toBe(12);
  });

  it("reads the Event's rest when the Tournament's row leaves it blank", () => {
    const s = sheet({
      minRestMinutes: 12,
      tournaments: [{ tournamentId: LONGSWORD, poolMatchDurationMinutes: 7 }],
    });
    expect(sheetRestFor(s, LONGSWORD)).toBe(12);
  });

  it("reads a Tournament's own rest before the Event's", () => {
    const s = sheet({
      minRestMinutes: 12,
      // The deciding row sits second: a reader that took the first would pass
      // this on the sabre row by accident.
      tournaments: [
        { tournamentId: SABRE, minRestMinutes: 3 },
        { tournamentId: LONGSWORD, minRestMinutes: 20 },
      ],
    });
    expect(sheetRestFor(s, LONGSWORD)).toBe(20);
    expect(sheetRestFor(s, SABRE)).toBe(3);
  });

  it('lets a Tournament take no break where the Event takes one', () => {
    // Zero is a rest, not a blank: absent and zero cannot be folded together.
    const s = sheet({
      minRestMinutes: 12,
      // Deciding row second: with it first, a reader that takes `tournaments[0]`
      // and ignores the id passes this by accident.
      tournaments: [
        { tournamentId: SABRE, minRestMinutes: 7 },
        { tournamentId: LONGSWORD, minRestMinutes: 0 },
      ],
    });
    expect(sheetRestFor(s, LONGSWORD)).toBe(0);
  });

  it("gives no break when the Event's own rest is zero", () => {
    expect(sheetRestFor(sheet({ minRestMinutes: 0 }), LONGSWORD)).toBe(0);
  });

  it('reads the Event rest for a Tournament it does not know', () => {
    const s = sheet({
      minRestMinutes: 12,
      tournaments: [{ tournamentId: SABRE, minRestMinutes: 3 }],
    });
    expect(sheetRestFor(s, 'a-tournament-with-no-row')).toBe(12);
  });
});

describe('sheetLengthFor', () => {
  it.each<[MatchKind, number]>([
    ['pool', 5],
    ['swiss', 5],
    ['elimination', 8],
    ['finals', 10],
  ])('reads the Event length for a %s bout', (kind, minutes) => {
    expect(sheetLengthFor(kind, sheet(), LONGSWORD)).toBe(minutes);
  });

  it('gives a Swiss bout its own Event length when one is typed', () => {
    expect(sheetLengthFor('swiss', sheet({ swissMatchDurationMinutes: 12 }), LONGSWORD)).toBe(12);
  });

  it.each<[MatchKind, number]>([
    ['pool', 7],
    ['swiss', 13],
    ['elimination', 9],
    ['finals', 15],
  ])("reads a Tournament's own %s length before the Event's", (kind, minutes) => {
    const s = sheet({
      tournaments: [
        {
          tournamentId: LONGSWORD,
          poolMatchDurationMinutes: 7,
          swissMatchDurationMinutes: 13,
          eliminationMatchDurationMinutes: 9,
          finalsMatchDurationMinutes: 15,
        },
      ],
    });
    expect(sheetLengthFor(kind, s, LONGSWORD)).toBe(minutes);
  });

  it("falls through to the Event when the Tournament's box is blank", () => {
    const s = sheet({ tournaments: [{ tournamentId: LONGSWORD, poolMatchDurationMinutes: 7 }] });
    expect(sheetLengthFor('finals', s, LONGSWORD)).toBe(10);
  });

  it('leaves another Tournament on the Event length', () => {
    const s = sheet({ tournaments: [{ tournamentId: LONGSWORD, poolMatchDurationMinutes: 7 }] });
    expect(sheetLengthFor('pool', s, SABRE)).toBe(5);
  });

  it("gives a Tournament's Swiss bout its own pool length before the Event's Swiss length", () => {
    const s = sheet({
      swissMatchDurationMinutes: 12,
      tournaments: [{ tournamentId: LONGSWORD, poolMatchDurationMinutes: 7 }],
    });
    expect(sheetLengthFor('swiss', s, LONGSWORD)).toBe(7);
  });
});

describe('finalRoundOf', () => {
  it('is the highest round among the Matches that exist', () => {
    expect(finalRoundOf([1, 3, 2, 3])).toBe(3);
  });

  it('ignores a Match whose round does not resolve', () => {
    expect(finalRoundOf([null, 2, null])).toBe(2);
  });

  it('is null when no round resolves', () => {
    expect(finalRoundOf([])).toBeNull();
    expect(finalRoundOf([null])).toBeNull();
  });
});

describe('isFinalsMatch', () => {
  it('is true only in the final round', () => {
    expect(isFinalsMatch(3, 3)).toBe(true);
    expect(isFinalsMatch(2, 3)).toBe(false);
  });

  it('is false when either round is unknown', () => {
    expect(isFinalsMatch(null, 3)).toBe(false);
    expect(isFinalsMatch(3, null)).toBe(false);
    expect(isFinalsMatch(null, null)).toBe(false);
  });
});

describe('matchKind', () => {
  it.each<[string, number | null, number | null, MatchKind]>([
    ['pool', null, null, 'pool'],
    ['swiss', null, null, 'swiss'],
    ['single_elim', 3, 3, 'finals'],
    ['single_elim', 2, 3, 'elimination'],
    ['double_elim', 5, 5, 'finals'],
    ['double_elim', null, 5, 'elimination'],
  ])('a %s Match in round %s of %s is %s', (phaseType, round, finalRound, kind) => {
    expect(matchKind(phaseType, round, finalRound)).toBe(kind);
  });

  it('calls the grand final finals when its reset slot has no Match yet', () => {
    // The reset slot sits one round past the grand final and has no Match until
    // it is needed. The final round is counted over Matches, so it is the grand
    // final's round.
    const roundsOfMatches = [1, 2, 3, 4];
    expect(matchKind('double_elim', 4, finalRoundOf(roundsOfMatches))).toBe('finals');
  });
});

describe('plannedLengthOf', () => {
  it('reads a resolved length', () => {
    expect(plannedLengthOf(new Map([['m1', 12]]), 'm1')).toBe(12);
  });

  it('throws for a Match that was never resolved, rather than guessing', () => {
    expect(() => plannedLengthOf(new Map([['m1', 12]]), 'm2')).toThrow(
      'No planned length for match m2',
    );
  });
});

describe('plannedEndIso', () => {
  it('ends at the latest END, not at the last start plus anything', () => {
    // A long bout early in the run finishes after the short one that starts last.
    expect(
      plannedEndIso([
        { scheduledAt: '2026-08-01T09:00:00.000Z', durationMinutes: 30 },
        { scheduledAt: '2026-08-01T09:10:00.000Z', durationMinutes: 5 },
      ]),
    ).toBe('2026-08-01T09:30:00.000Z');
  });

  it("gives a one-bout run that bout's own length", () => {
    expect(plannedEndIso([{ scheduledAt: '2026-08-01T09:00:00.000Z', durationMinutes: 12 }])).toBe(
      '2026-08-01T09:12:00.000Z',
    );
  });

  it('ignores a bout with no time, and has no end when none has one', () => {
    expect(
      plannedEndIso([
        { scheduledAt: '2026-08-01T09:00:00.000Z', durationMinutes: 7 },
        { scheduledAt: null, durationMinutes: 60 },
      ]),
    ).toBe('2026-08-01T09:07:00.000Z');
    expect(plannedEndIso([{ scheduledAt: null, durationMinutes: 7 }])).toBeNull();
    expect(plannedEndIso([])).toBeNull();
  });
});
