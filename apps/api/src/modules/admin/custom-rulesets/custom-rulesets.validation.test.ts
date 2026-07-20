/**
 * The exported pure validators of the custom-ruleset service — split out of
 * custom-rulesets.service.test.ts when that file crossed the 400-line cap.
 *
 * The split is along a real seam, not an arbitrary line count: nothing here
 * constructs the service or touches Supabase. These are total functions over
 * their input, which is exactly why they carry the security-shaped assertions
 * (no free-text formula, no out-of-whitelist variable, no stale afterblow rule
 * left behind when afterblow is switched off).
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DOUBLE_PENALTY_FORMULA_KEYS, FEDERAL_DOUBLE_PENALTY_AST } from '@myclash/rulesets';
import {
  grammarColumns,
  validateDoublePenaltyFormula,
  validateTfConfigPatch,
} from './custom-rulesets.service';

describe('validateDoublePenaltyFormula', () => {
  // This used to accept any character-whitelisted expression and sanity-check it
  // with `new Function('n', ...)`. AGENTS.md hard rule #5 forbids eval/Function
  // outright, and a character filter cannot make code execution safe — it only
  // makes it narrow. The engine's whitelist is now the only accepted input.
  it('accepts every key the engine can actually dispatch on', () => {
    for (const key of DOUBLE_PENALTY_FORMULA_KEYS) {
      expect(validateDoublePenaltyFormula(key)).toBe(key);
    }
  });

  it('trims surrounding whitespace', () => {
    expect(validateDoublePenaltyFormula('  n*(n-1)/3  ')).toBe('n*(n-1)/3');
  });

  it('rejects an expression the engine cannot dispatch on', () => {
    // 'n*2' passed the old character filter, then broke every tournament
    // create/update on that ruleset once doublePenaltyFormula became a z.enum —
    // and if it slipped past, the engine silently used the federal formula.
    expect(() => validateDoublePenaltyFormula('n*2')).toThrow(BadRequestException);
    expect(() => validateDoublePenaltyFormula('n*2')).toThrow(/Allowed values/);
  });

  it('rejects an empty formula', () => {
    expect(() => validateDoublePenaltyFormula('   ')).toThrow(BadRequestException);
  });

  it('rejects a code-execution attempt outright', () => {
    expect(() => validateDoublePenaltyFormula('process.exit(1)')).toThrow(BadRequestException);
  });
});

// ── grammar columns (migration 0143) ─────────────────────────────────────────
// `tf_config.targetValues` was read only for is_system rows, so an org-authored
// ruleset had nowhere to declare its targets or whether it uses afterblow.

describe('grammarColumns', () => {
  it('maps only the fields the caller actually sent', () => {
    expect(grammarColumns({})).toEqual({});
    expect(grammarColumns({ targets: [{ name: 'Head', value: 3 }] })).toEqual({
      targets: [{ name: 'Head', value: 3 }],
    });
  });

  it('clears everything afterblow-only when afterblow is turned off', () => {
    // A mode or a valuation without the concept is meaningless, and a stale one
    // would seed a tournament with a grid this ruleset cannot produce.
    expect(grammarColumns({ hasAfterblow: false })).toEqual({
      has_afterblow: false,
      afterblow_mode: null,
      afterblow_valuation: null,
      afterblow_fixed_value: null,
    });
  });

  it('refuses to set afterblow fields while afterblow is being turned off', () => {
    expect(
      grammarColumns({
        hasAfterblow: false,
        afterblowMode: 'deductive',
        afterblowValuation: 'weighted',
        afterblowFixedValue: 3,
      }),
    ).toEqual({
      has_afterblow: false,
      afterblow_mode: null,
      afterblow_valuation: null,
      afterblow_fixed_value: null,
    });
  });

  it('sets the mode when afterblow is on', () => {
    expect(grammarColumns({ hasAfterblow: true, afterblowMode: 'deductive' })).toEqual({
      has_afterblow: true,
      afterblow_mode: 'deductive',
    });
  });

  it('persists the valuation that decides the button grid', () => {
    expect(grammarColumns({ hasAfterblow: true, afterblowValuation: 'weighted' })).toEqual({
      has_afterblow: true,
      afterblow_valuation: 'weighted',
    });
    expect(grammarColumns({ afterblowValuation: 'fixed', afterblowFixedValue: 2 })).toEqual({
      afterblow_valuation: 'fixed',
      afterblow_fixed_value: 2,
    });
  });

  it('allows a mode change without restating hasAfterblow', () => {
    expect(grammarColumns({ afterblowMode: 'full' })).toEqual({ afterblow_mode: 'full' });
  });
});

// ── authored double-penalty AST via tf_config ────────────────────────────────
// The whitelist is not the only expression path any more. A club with a house
// rule authors a FormulaNode AST, which reaches the engine through
// tf_config.doublePenaltyFormula (JSONB) rather than the key-only TEXT column.
// AGENTS.md rule #5 still holds: this is Zod-validated data evaluated by our
// own interpreter, never constructed code.

describe('validateTfConfigPatch — double penalty', () => {
  it('accepts the federal formula as an authored AST', () => {
    const out = validateTfConfigPatch({ doublePenaltyFormula: FEDERAL_DOUBLE_PENALTY_AST });
    expect(out['doublePenaltyFormula']).toEqual(FEDERAL_DOUBLE_PENALTY_AST);
  });

  it('accepts a house rule the whitelist has no key for', () => {
    // Half a penalty point per double — the case that previously required
    // shipping a release to add a fifth whitelist entry.
    const houseRule = {
      type: 'binop',
      op: '/',
      left: { type: 'var', name: 'doubleHits' },
      right: { type: 'literal', value: 2 },
    };
    expect(
      validateTfConfigPatch({ doublePenaltyFormula: houseRule })['doublePenaltyFormula'],
    ).toEqual(houseRule);
  });

  it('still accepts every legacy key, so stored values keep validating', () => {
    for (const key of DOUBLE_PENALTY_FORMULA_KEYS) {
      expect(validateTfConfigPatch({ doublePenaltyFormula: key })['doublePenaltyFormula']).toBe(
        key,
      );
    }
  });

  it('rejects a malformed AST at authoring time, not at scoring time', () => {
    expect(() =>
      validateTfConfigPatch({ doublePenaltyFormula: { type: 'binop', op: '**' } }),
    ).toThrow(BadRequestException);
  });

  it('rejects an AST referencing a variable outside the whitelist', () => {
    expect(() =>
      validateTfConfigPatch({ doublePenaltyFormula: { type: 'var', name: 'n' } }),
    ).toThrow(BadRequestException);
  });

  it('rejects free text, which is the thing rule #5 actually forbids', () => {
    expect(() => validateTfConfigPatch({ doublePenaltyFormula: 'n*2' })).toThrow(
      BadRequestException,
    );
    expect(() => validateTfConfigPatch({ doublePenaltyFormula: 'process.exit(1)' })).toThrow(
      BadRequestException,
    );
  });
});
