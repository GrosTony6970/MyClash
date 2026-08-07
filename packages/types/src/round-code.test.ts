import { describe, expect, it } from 'vitest';
import {
  bracketRoundLabel,
  bracketToken,
  doubleElimRoundLabel,
  formatRoundCode,
  roundTokenLabel,
  weaponAbbr,
} from './round-code';

describe('weaponAbbr', () => {
  it('returns canonical abbreviations for the five known weapons', () => {
    expect(weaponAbbr('Longsword')).toBe('LSW');
    expect(weaponAbbr('Sidesword')).toBe('SDW');
    expect(weaponAbbr('Rapier')).toBe('RAP');
    expect(weaponAbbr('Sabre')).toBe('SBR');
    expect(weaponAbbr('Sword & Buckler')).toBe('SB');
    expect(weaponAbbr('Sword and Buckler')).toBe('SB');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(weaponAbbr('  longSWORD  ')).toBe('LSW');
    expect(weaponAbbr('SABRE')).toBe('SBR');
  });

  it('falls back to first 3 letters uppercased and strips punctuation', () => {
    expect(weaponAbbr('Dagger')).toBe('DAG');
    expect(weaponAbbr('Messer')).toBe('MES');
    expect(weaponAbbr('Sword/Mace')).toBe('SWO');
    expect(weaponAbbr('AB')).toBe('AB'); // less than 3 letters → as-is
  });

  it('returns ??? for empty / nullish inputs', () => {
    expect(weaponAbbr('')).toBe('???');
    expect(weaponAbbr(null)).toBe('???');
    expect(weaponAbbr(undefined)).toBe('???');
    expect(weaponAbbr('   ')).toBe('???');
    expect(weaponAbbr('123 -- !!')).toBe('???');
  });
});

describe('bracketRoundLabel', () => {
  it('resolves 32-bracket rounds to R32 / R16 / QF / SF / F', () => {
    expect(bracketRoundLabel(1, 32)).toBe('R32');
    expect(bracketRoundLabel(2, 32)).toBe('R16');
    expect(bracketRoundLabel(3, 32)).toBe('QF');
    expect(bracketRoundLabel(4, 32)).toBe('SF');
    expect(bracketRoundLabel(5, 32)).toBe('F');
  });

  it('resolves 64- and 128-brackets to deeper R-labels', () => {
    expect(bracketRoundLabel(1, 64)).toBe('R64');
    expect(bracketRoundLabel(2, 64)).toBe('R32');
    expect(bracketRoundLabel(6, 64)).toBe('F');
    expect(bracketRoundLabel(1, 128)).toBe('R128');
    expect(bracketRoundLabel(7, 128)).toBe('F');
  });

  it('rounds non-power-of-two brackets up to the next power', () => {
    // 24-fighter bracket → 5 rounds (treated as 32)
    expect(bracketRoundLabel(1, 24)).toBe('R32');
    expect(bracketRoundLabel(5, 24)).toBe('F');
  });

  it('falls back to B<round> when bracketSize is null/0/1', () => {
    expect(bracketRoundLabel(1, null)).toBe('B1');
    expect(bracketRoundLabel(2, 0)).toBe('B2');
    expect(bracketRoundLabel(3, 1)).toBe('B3');
  });

  it('returns empty string for invalid rounds', () => {
    expect(bracketRoundLabel(0, 32)).toBe('');
    expect(bracketRoundLabel(-1, 32)).toBe('');
    expect(bracketRoundLabel(1.5, 32)).toBe('');
  });
});

describe('formatRoundCode', () => {
  it('produces LSW-P1-M3 for a typical pool match', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: 1,
        bracketRound: null,
        bracketSize: null,
        matchNumber: 3,
      }),
    ).toBe('LSW-P1-M3');
  });

  it('produces RAP-P2-M5 with a different weapon + pool', () => {
    expect(
      formatRoundCode({
        weapon: 'Rapier',
        poolNumber: 2,
        bracketRound: null,
        bracketSize: null,
        matchNumber: 5,
      }),
    ).toBe('RAP-P2-M5');
  });

  it('produces LSW-B-QF-M1 for a quarter-final in a 32-bracket', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 3,
        bracketSize: 32,
        matchNumber: 1,
      }),
    ).toBe('LSW-B-QF-M1');
  });

  it('produces LSW-B-F-M1 for the final', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 5,
        bracketSize: 32,
        matchNumber: 1,
      }),
    ).toBe('LSW-B-F-M1');
  });

  it('produces LSW-B-R16-M1 for the first round of a 16-bracket', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 1,
        bracketSize: 16,
        matchNumber: 1,
      }),
    ).toBe('LSW-B-R16-M1');
  });

  it('produces LSW-B-PI-M5 for a play-in match (round 0)', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 0,
        bracketSize: 16,
        matchNumber: 5,
      }),
    ).toBe('LSW-B-PI-M5');
  });

  it('produces LSW-B-B2-M3 when bracketSize is unknown — double-B is acceptable', () => {
    // Rare: only fires when bracketSize is null. The 'B' from the
    // new bracket marker collides with the bracketRoundLabel
    // fallback 'B<round>' — operators still see B clearly so it's
    // not worth carving an exception.
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 2,
        bracketSize: null,
        matchNumber: 3,
      }),
    ).toBe('LSW-B-B2-M3');
  });

  it('handles custom weapon names via the 3-letter fallback', () => {
    expect(
      formatRoundCode({
        weapon: 'Dussack',
        poolNumber: 1,
        bracketRound: null,
        bracketSize: null,
        matchNumber: 1,
      }),
    ).toBe('DUS-P1-M1');
  });

  it('accepts string match labels', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: 1,
        bracketRound: null,
        bracketSize: null,
        matchNumber: 'R1',
      }),
    ).toBe('LSW-P1-MR1');
  });

  it('extracts the bare match number from a compound pool label (no double-encoding)', () => {
    // match_number_label for pools is "L<lice>-P<pool>-M<seq>" (e.g.
    // "L1-PA-M1"). Feeding the whole string used to produce the doubled
    // form LSW-P1-ML1-PA-M1; we want the documented LSW-P1-M1.
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: 1,
        bracketRound: null,
        bracketSize: null,
        matchNumber: 'L1-PA-M1',
      }),
    ).toBe('LSW-P1-M1');
  });

  it('keeps a two-digit sequence from a compound pool label', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: 1,
        bracketRound: null,
        bracketSize: null,
        matchNumber: 'L1-PA-M10',
      }),
    ).toBe('LSW-P1-M10');
  });

  it('leaves a bare numeric bracket label intact', () => {
    // bracket_slots store match_number_label = String(slot.position),
    // a bare number — it must still render cleanly.
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 3,
        bracketSize: 32,
        matchNumber: '3',
      }),
    ).toBe('LSW-B-QF-M3');
  });

  it('degrades gracefully on missing inputs — no dangling dashes', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: null,
        bracketSize: null,
        matchNumber: null,
      }),
    ).toBe('LSW');
    expect(
      formatRoundCode({
        weapon: '',
        poolNumber: 1,
        bracketRound: null,
        bracketSize: null,
        matchNumber: 2,
      }),
    ).toBe('???-P1-M2');
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: null,
        bracketSize: null,
        matchNumber: '',
      }),
    ).toBe('LSW');
  });
});

// ── Swiss ────────────────────────────────────────────────────────────────────

describe('formatRoundCode — Swiss', () => {
  const swiss = (over: Partial<Parameters<typeof formatRoundCode>[0]> = {}) =>
    formatRoundCode({
      weapon: 'Longsword',
      poolNumber: null,
      bracketRound: null,
      bracketSize: null,
      swissRound: 3,
      matchNumber: 2,
      ...over,
    });

  it('produces LSW-S3-M2 for a Swiss round-3 match', () => {
    expect(swiss()).toBe('LSW-S3-M2');
  });

  it('never emits the segment-less LSW-M<n> a Swiss match used to produce', () => {
    // The regression this whole branch exists for: no pool number and no
    // bracket round meant no middle segment at all, so a Swiss match was
    // indistinguishable from an unclassifiable one.
    const before = formatRoundCode({
      weapon: 'Longsword',
      poolNumber: null,
      bracketRound: null,
      bracketSize: null,
      matchNumber: 2,
    });
    expect(before).toBe('LSW-M2');
    expect(swiss()).not.toBe(before);
  });

  it('strips the trailing M<n> out of a compound Swiss match label', () => {
    // Swiss matches store `SW-R{n}-M{b}` in match_number_label; prefixing that
    // whole string with M would give the doubled LSW-S1-MSW-R1-M3.
    expect(swiss({ swissRound: 1, matchNumber: 'SW-R1-M3' })).toBe('LSW-S1-M3');
  });

  it('is ignored when a pool number is present, and outranks a bracket round', () => {
    // Mutually exclusive on a real row; assert the precedence anyway so a
    // malformed row degrades predictably rather than emitting two segments.
    expect(swiss({ poolNumber: 1 })).toBe('LSW-P1-M2');
    expect(swiss({ bracketRound: 3, bracketSize: 32 })).toBe('LSW-S3-M2');
  });

  it('treats an absent or null swissRound as no Swiss segment', () => {
    expect(swiss({ swissRound: null })).toBe('LSW-M2');
    expect(swiss({ swissRound: undefined })).toBe('LSW-M2');
  });
});

// ── Double elimination ───────────────────────────────────────────────────────

describe('doubleElimRoundLabel', () => {
  // 8-fighter double elim: wbRounds=3, lbRounds=4 → WB 1-3, LB 4-7, GF 8, reset 9.
  const label = (round: number) => doubleElimRoundLabel(round, 3, 4);

  it('names the winners bracket by depth, prefixed so it is not the grand final', () => {
    expect(label(1)).toBe('WBQF');
    expect(label(2)).toBe('WBSF');
    // The critical one: this is the WINNERS final, not the tournament final.
    expect(label(3)).toBe('WBF');
  });

  it('numbers losers rounds LB-relative, not by absolute round', () => {
    expect(label(4)).toBe('LB1');
    expect(label(7)).toBe('LB4');
  });

  it('names the grand final and its reset distinctly', () => {
    expect(label(8)).toBe('GF');
    expect(label(9)).toBe('GFR');
  });

  it('labels the play-in round', () => {
    expect(label(0)).toBe('PI');
  });

  it('gives every round of the bracket a distinct label', () => {
    const labels = Array.from({ length: 10 }, (_, r) => label(r));
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('formatRoundCode — double elimination', () => {
  it('uses section-aware labels when the round split is supplied', () => {
    const code = (bracketRound: number) =>
      formatRoundCode({
        weapon: 'longsword',
        poolNumber: null,
        bracketRound,
        bracketSize: 8,
        matchNumber: 1,
        wbRounds: 3,
        lbRounds: 4,
      });
    expect(code(3)).toBe('LSW-B-WBF-M1');
    expect(code(5)).toBe('LSW-B-LB2-M1');
    expect(code(8)).toBe('LSW-B-GF-M1');
  });

  it('is byte-identical to the single-elim form when no split is supplied', () => {
    // Regression guard: threading wbRounds/lbRounds through the input must not
    // change ANY existing single-elim code.
    for (const round of [0, 1, 2, 3, 4, 5]) {
      const base = { weapon: 'longsword', poolNumber: null, bracketRound: round, matchNumber: 2 };
      expect(formatRoundCode({ ...base, bracketSize: 32 })).toBe(
        formatRoundCode({ ...base, bracketSize: 32, wbRounds: null, lbRounds: null }),
      );
    }
  });
});

// ── Token extraction (shared by the code and the display label) ──────────────

describe('bracketToken', () => {
  it('returns the same token formatRoundCode embeds after the B segment', () => {
    // The whole point of extracting it: a surface showing the round WITHOUT
    // the code must not be able to drift from the code operators announce.
    const cases = [
      { bracketRound: 1, bracketSize: 32 },
      { bracketRound: 3, bracketSize: 32 },
      { bracketRound: 5, bracketSize: 32 },
      { bracketRound: 0, bracketSize: 32 },
      { bracketRound: 2, bracketSize: null },
      { bracketRound: 3, bracketSize: 8, wbRounds: 3, lbRounds: 4 },
      { bracketRound: 5, bracketSize: 8, wbRounds: 3, lbRounds: 4 },
      { bracketRound: 8, bracketSize: 8, wbRounds: 3, lbRounds: 4 },
      { bracketRound: 9, bracketSize: 8, wbRounds: 3, lbRounds: 4 },
    ];
    for (const c of cases) {
      const code = formatRoundCode({ ...c, weapon: 'longsword', poolNumber: null, matchNumber: 1 });
      expect(code).toBe(`LSW-B-${bracketToken(c)}-M1`);
    }
  });

  it('is section-aware for double elim — three rounds that single-elim calls F', () => {
    const de = { bracketSize: 8, wbRounds: 3, lbRounds: 4 };
    expect(bracketToken({ ...de, bracketRound: 3 })).toBe('WBF');
    expect(bracketToken({ ...de, bracketRound: 8 })).toBe('GF');
    expect(bracketToken({ ...de, bracketRound: 9 })).toBe('GFR');
    // Without the split, all three collapse to the single-elim label — the
    // exact defect that made the TV header call every one of them "F".
    expect(bracketToken({ bracketSize: 8, bracketRound: 3 })).toBe('F');
  });

  it('returns null when the match has no bracket round at all', () => {
    expect(bracketToken({ bracketRound: null, bracketSize: 32 })).toBeNull();
    // RoundCodeInput declares `bracketRound: number | null`, so the undefined
    // arm is unreachable by type — but bracketToken guards it anyway, because a
    // partial Supabase select delivers an unselected column as undefined rather
    // than null. The cast is what lets the test reach that branch; widening the
    // shared interface is a separate decision with a repo-wide blast radius.
    const unselected = { bracketRound: undefined, bracketSize: 32 } as unknown as Parameters<
      typeof bracketToken
    >[0];
    expect(bracketToken(unselected)).toBeNull();
  });
});

// ── Human phase names ────────────────────────────────────────────────────────

describe('roundTokenLabel', () => {
  it('names every single-elim token', () => {
    expect(roundTokenLabel('F')).toEqual({ key: 'common.round.final' });
    expect(roundTokenLabel('SF')).toEqual({ key: 'common.round.semiFinal' });
    expect(roundTokenLabel('QF')).toEqual({ key: 'common.round.quarterFinal' });
    expect(roundTokenLabel('PI')).toEqual({ key: 'common.round.playIn' });
    expect(roundTokenLabel('R16')).toEqual({
      key: 'common.round.roundOf',
      params: { count: '16' },
    });
    expect(roundTokenLabel('B4')).toEqual({ key: 'common.round.bracketRound', params: { n: '4' } });
  });

  it('names every double-elim token', () => {
    expect(roundTokenLabel('GF')).toEqual({ key: 'common.round.grandFinal' });
    expect(roundTokenLabel('GFR')).toEqual({ key: 'common.round.grandFinalReset' });
    expect(roundTokenLabel('WBF')).toEqual({ key: 'common.round.winnersFinal' });
    expect(roundTokenLabel('WBSF')).toEqual({ key: 'common.round.winnersSemiFinal' });
    expect(roundTokenLabel('WBQF')).toEqual({ key: 'common.round.winnersQuarterFinal' });
    expect(roundTokenLabel('LB2')).toEqual({
      key: 'common.round.losersRound',
      params: { n: '2' },
    });
    expect(roundTokenLabel('WBR16')).toEqual({
      key: 'common.round.winnersRoundOf',
      params: { count: '16' },
    });
    expect(roundTokenLabel('WBB2')).toEqual({
      key: 'common.round.winnersRound',
      params: { n: '2' },
    });
  });

  it('names Swiss rounds, which no bracket function emits', () => {
    // The TV header needs ONE field that names the phase for every match kind;
    // a Swiss bout previously showed no phase segment whatsoever.
    expect(roundTokenLabel('S3')).toEqual({ key: 'common.round.swissRound', params: { n: '3' } });
  });

  it('does not mistake a winners-bracket token for its single-elim namesake', () => {
    expect(roundTokenLabel('WBR16')?.key).not.toBe(roundTokenLabel('R16')?.key);
    expect(roundTokenLabel('WBB2')?.key).not.toBe(roundTokenLabel('B2')?.key);
  });

  it('returns null for nothing and for unrecognised tokens', () => {
    // Callers omit the segment rather than render a raw code at the audience.
    expect(roundTokenLabel(null)).toBeNull();
    expect(roundTokenLabel(undefined)).toBeNull();
    expect(roundTokenLabel('')).toBeNull();
    expect(roundTokenLabel('P1')).toBeNull();
    expect(roundTokenLabel('nonsense')).toBeNull();
  });

  it('covers every token bracketToken and formatRoundCode can produce', () => {
    // Guards the pairing: a new token shape added to the generator must get a
    // name here, or the display silently drops the phase.
    const emitted = new Set<string>();
    for (const size of [null, 2, 4, 8, 16, 32, 64, 128]) {
      for (let round = 0; round <= 8; round++) {
        const t = bracketToken({ bracketRound: round, bracketSize: size });
        if (t) emitted.add(t);
      }
    }
    for (let round = 0; round <= 9; round++) {
      const t = bracketToken({ bracketRound: round, bracketSize: 8, wbRounds: 3, lbRounds: 4 });
      if (t) emitted.add(t);
    }
    for (const token of emitted) {
      expect(roundTokenLabel(token), `no label for token ${token}`).not.toBeNull();
    }
    expect(emitted.size).toBeGreaterThan(10);
  });
});
