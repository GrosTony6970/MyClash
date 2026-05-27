import { describe, expect, it } from 'vitest';
import { bracketRoundLabel, formatRoundCode, weaponAbbr } from './round-code';

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

  it('produces LSW-QF-M1 for a quarter-final in a 32-bracket', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 3,
        bracketSize: 32,
        matchNumber: 1,
      }),
    ).toBe('LSW-QF-M1');
  });

  it('produces LSW-F-M1 for the final', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 5,
        bracketSize: 32,
        matchNumber: 1,
      }),
    ).toBe('LSW-F-M1');
  });

  it('produces LSW-B2-M3 when bracketSize is unknown', () => {
    expect(
      formatRoundCode({
        weapon: 'Longsword',
        poolNumber: null,
        bracketRound: 2,
        bracketSize: null,
        matchNumber: 3,
      }),
    ).toBe('LSW-B2-M3');
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
