import { describe, expect, it } from 'vitest';
import type { SuggestConfig } from '@myclash/types';
import { PROGRAMME_CONFIG_DEFAULTS } from '../programme/dto/programme.dto';
import { sheetLengthFor, type MatchKind } from './planned-length';

const LONGSWORD = 'longsword';
const SABRE = 'sabre';

function sheet(over: Partial<SuggestConfig> = {}): SuggestConfig {
  return { ...PROGRAMME_CONFIG_DEFAULTS, ...over };
}

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
