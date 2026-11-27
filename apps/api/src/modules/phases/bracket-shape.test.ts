import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { buildBracketShape } from './bracket-shape';

/** The refusal `buildBracketShape` throws: a 400 and its message. */
function refusal(run: () => unknown): { status: number; message: string } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const refused = error as BadRequestException;
    return { status: refused.getStatus(), message: refused.message };
  }
  throw new Error('no refusal');
}

describe('buildBracketShape', () => {
  it('builds a single-elimination bracket by default, and a double one when asked', () => {
    const single = buildBracketShape(16, { bracketSize: 16 });
    expect(single.phaseType).toBe('single_elim');
    expect(single.bracket.bracketSize).toBe(16);
    const double = buildBracketShape(8, { phaseType: 'double_elim' });
    expect(double.phaseType).toBe('double_elim');
    expect(double.bracket.bracketSize).toBe(8);
  });

  it.each([
    [16, 8, 'bracketSize (8) must be ≥ fighterCount (16)'],
    [8, 12, 'bracketSize must be a power of 2 (got 12)'],
  ])(
    'refuses %i fighters in a single bracket of %i with the builder’s words',
    (count, size, words) => {
      expect(refusal(() => buildBracketShape(count, { bracketSize: size }))).toEqual({
        status: 400,
        message: words,
      });
    },
  );

  it('refuses a double bracket the builder cannot make, with its words', () => {
    const refused = refusal(() =>
      buildBracketShape(8, { phaseType: 'double_elim', bracketSize: 12 }),
    );
    expect(refused).toEqual({ status: 400, message: 'bracketSize must be a power of 2 (got 12)' });
  });
});
