import { describe, expect, it } from 'vitest';
import { formatBracketMatchLabel } from './format-bracket-match-label';

const identity = (key: string) => key;

describe('formatBracketMatchLabel', () => {
  it('labels the round=maxRound position=1 match as Final', () => {
    expect(formatBracketMatchLabel(3, 1, 3, identity)).toBe('organizer.bracketPage.rounds.final');
  });

  it('labels the round=maxRound position=2 match as Bronze', () => {
    expect(formatBracketMatchLabel(3, 2, 3, identity)).toBe('organizer.bracketPage.rounds.bronze');
  });

  it('labels round=maxRound-1 as Semi-final with position suffix', () => {
    expect(formatBracketMatchLabel(2, 1, 3, identity)).toBe('organizer.bracketPage.rounds.semi #1');
  });

  it('labels round=maxRound-2 as Quarter-final with position suffix', () => {
    expect(formatBracketMatchLabel(1, 3, 3, identity)).toBe('organizer.bracketPage.rounds.qf #3');
  });

  it('labels round=maxRound-3 as Round of 16 with position suffix', () => {
    expect(formatBracketMatchLabel(0, 5, 3, identity)).toBe('organizer.bracketPage.rounds.r16 #5');
  });

  it('labels round=maxRound-4 as Round of 32 with position suffix', () => {
    expect(formatBracketMatchLabel(0, 5, 4, identity)).toBe('organizer.bracketPage.rounds.r32 #5');
  });

  it('falls back to R{round} #{position} for deeper or unknown rounds', () => {
    expect(formatBracketMatchLabel(0, 2, 8, identity)).toBe('R0 #2');
  });

  it('falls back to R0 #{position} when maxRound is zero (no bracket info)', () => {
    expect(formatBracketMatchLabel(0, 1, 0, identity)).toBe('R0 #1');
  });
});
