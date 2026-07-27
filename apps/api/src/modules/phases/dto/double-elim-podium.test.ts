import { describe, expect, it } from 'vitest';
import { GenerateBracketDto } from './phases.dto';
import { EditBracketConfigDto } from './edit-bracket-config.dto';

/**
 * The double-elim podium options REJECT inapplicable combinations rather than
 * silently dropping them. That is a deliberate decision, not strictness for its
 * own sake: this codebase has already shipped one silently-ignored double-elim
 * flag (`grandFinalReset` was stamped into config_json but never reached the
 * generator, so the slot it controlled was never created), and the symptom was
 * an option that looked enabled everywhere while doing nothing.
 */

const generate = GenerateBracketDto.schema;
const edit = EditBracketConfigDto.schema;

const de = (extra: Record<string, unknown>) => ({ phaseType: 'double_elim', ...extra });

describe('double-elim podium options — generate', () => {
  it('accepts the classical bracket with no podium options at all', () => {
    expect(generate.safeParse({ phaseType: 'double_elim' }).success).toBe(true);
  });

  it('accepts gold mode with a grand-final reset', () => {
    expect(
      generate.safeParse(de({ secondChanceTarget: 'gold', grandFinalReset: true })).success,
    ).toBe(true);
  });

  it('accepts bronze mode with and without a bronze match', () => {
    for (const bronzeMatch of [true, false]) {
      expect(generate.safeParse(de({ secondChanceTarget: 'bronze', bronzeMatch })).success).toBe(
        true,
      );
    }
  });

  it('rejects a bronze match in gold mode — third place is already decided', () => {
    const result = generate.safeParse(de({ secondChanceTarget: 'gold', bronzeMatch: true }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('bronzeMatch');
  });

  it('rejects a bronze match when the mode is left at its gold default', () => {
    expect(generate.safeParse(de({ bronzeMatch: false })).success).toBe(false);
  });

  it('rejects a grand-final reset in bronze mode — there is no grand final', () => {
    const result = generate.safeParse(de({ secondChanceTarget: 'bronze', grandFinalReset: true }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('grandFinalReset');
  });

  it('allows an explicitly false grand-final reset in bronze mode', () => {
    // Only `true` is a contradiction; false is the same as omitting it, and the
    // form posts whatever the checkbox holds.
    expect(
      generate.safeParse(de({ secondChanceTarget: 'bronze', grandFinalReset: false })).success,
    ).toBe(true);
  });

  it('accepts every cutoff the UI offers, plus null for "everyone"', () => {
    for (const repechageEntrySize of [8, 16, 32, null]) {
      expect(generate.safeParse(de({ repechageEntrySize })).success).toBe(true);
    }
  });

  it('rejects a cutoff that is not one of the offered sizes', () => {
    expect(generate.safeParse(de({ repechageEntrySize: 12 })).success).toBe(false);
    expect(generate.safeParse(de({ repechageEntrySize: 64 })).success).toBe(false);
  });

  it('rejects podium options on a single-elim bracket', () => {
    for (const extra of [
      { secondChanceTarget: 'bronze' },
      { bronzeMatch: true },
      { repechageEntrySize: 8 },
    ]) {
      expect(generate.safeParse({ phaseType: 'single_elim', ...extra }).success).toBe(false);
    }
  });

  it('still tolerates grandFinalReset on single-elim (pre-existing behaviour)', () => {
    // Deliberately NOT tightened: this flag predates the podium options and
    // callers have always been allowed to send it harmlessly.
    expect(generate.safeParse({ phaseType: 'single_elim', grandFinalReset: true }).success).toBe(
      true,
    );
  });
});

describe('double-elim podium options — edit', () => {
  it('validates the same cross-field rules as generation', () => {
    expect(edit.safeParse({ secondChanceTarget: 'gold', bronzeMatch: true }).success).toBe(false);
    expect(edit.safeParse({ secondChanceTarget: 'bronze', grandFinalReset: true }).success).toBe(
      false,
    );
    expect(edit.safeParse({ grandFinalReset: true }).success).toBe(true);
  });

  it('rejects unknown fields (strict)', () => {
    expect(edit.safeParse({ grandFinalReset: true, surprise: 'x' }).success).toBe(false);
  });
});
