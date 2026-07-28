import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FormulaNodeSchema, MAX_FORMULA_DEPTH, exceedsMaxFormulaDepth } from './types';
import type { FormulaNode } from './types';

const literal: FormulaNode = { type: 'literal', value: 1 };

/** A left-leaning chain of `n` nested binops. */
function chain(n: number): FormulaNode {
  return n === 0 ? literal : { type: 'binop', op: '+', left: literal, right: chain(n - 1) };
}

describe('FormulaNodeSchema — accepts what it always accepted', () => {
  it('accepts the three node kinds', () => {
    expect(FormulaNodeSchema.safeParse(literal).success).toBe(true);
    expect(FormulaNodeSchema.safeParse({ type: 'var', name: 'victories' }).success).toBe(true);
    expect(FormulaNodeSchema.safeParse(chain(1)).success).toBe(true);
  });

  it('rejects unknown node types, unknown variables and non-finite literals', () => {
    expect(FormulaNodeSchema.safeParse({ type: 'nope' }).success).toBe(false);
    expect(FormulaNodeSchema.safeParse({ type: 'var', name: 'notAVariable' }).success).toBe(false);
    expect(FormulaNodeSchema.safeParse({ type: 'literal', value: Infinity }).success).toBe(false);
  });

  it('keeps the exact depth cutoff the eager schema had', () => {
    // The old schema returned z.never() at MAX_FORMULA_DEPTH, so 31 nested
    // binops parsed and 32 did not. That boundary is behaviour, not an accident.
    expect(FormulaNodeSchema.safeParse(chain(MAX_FORMULA_DEPTH - 1)).success).toBe(true);
    expect(FormulaNodeSchema.safeParse(chain(MAX_FORMULA_DEPTH)).success).toBe(false);
    expect(FormulaNodeSchema.safeParse(chain(MAX_FORMULA_DEPTH + 1)).success).toBe(false);
  });

  it('returns the parsed node unchanged', () => {
    const parsed = FormulaNodeSchema.parse(chain(3));
    expect(parsed).toEqual(chain(3));
  });
});

describe('exceedsMaxFormulaDepth — rejects hostile input without blowing the stack', () => {
  it('survives input far deeper than the call stack', () => {
    // Built iteratively: a recursive builder would overflow before the assert.
    let deep: FormulaNode = literal;
    for (let i = 0; i < 200_000; i += 1)
      deep = { type: 'binop', op: '+', left: literal, right: deep };

    expect(exceedsMaxFormulaDepth(deep)).toBe(true);
    // The schema must REJECT it, not throw a RangeError from stack exhaustion.
    expect(() => FormulaNodeSchema.safeParse(deep)).not.toThrow();
    expect(FormulaNodeSchema.safeParse(deep).success).toBe(false);
  });

  it('counts depth down both branches, not just the first', () => {
    const deepOnRight: FormulaNode = { type: 'binop', op: '+', left: literal, right: chain(40) };
    expect(exceedsMaxFormulaDepth(deepOnRight)).toBe(true);
  });

  it('ignores non-binop nodes and non-objects', () => {
    expect(exceedsMaxFormulaDepth(literal)).toBe(false);
    expect(exceedsMaxFormulaDepth(null)).toBe(false);
    expect(exceedsMaxFormulaDepth('nope')).toBe(false);
  });
});

describe('FormulaNodeSchema — JSON Schema stays finite', () => {
  /**
   * The regression guard. This schema used to build a fresh child schema per
   * level, 32 levels deep — a 2^32-node tree that only materialised during JSON
   * Schema conversion. It made `SwaggerModule.createDocument` unable to finish
   * at ANY heap size, so the typed API client could not be regenerated at all
   * and silently drifted 41 routes out of date.
   *
   * A cyclic schema emits one `$ref`. If anyone reintroduces per-level schema
   * construction, this test is what catches it.
   */
  it('converts to a small JSON Schema', () => {
    const json = JSON.stringify(z.toJSONSchema(FormulaNodeSchema, { io: 'input' }));
    expect(json.length).toBeLessThan(10_000);
  });

  it('still describes the node shape, rather than documenting it as "anything"', () => {
    // The depth guard is a `.pipe()`, and zod describes a pipe by its INPUT
    // side — `unknown`, i.e. `{}`. The `.meta()` override is what puts the real
    // shape back. Without it the typed client would type this field as unknown.
    const json = JSON.stringify(z.toJSONSchema(FormulaNodeSchema, { io: 'input' }));
    expect(json).toContain('binop');
    expect(json).toContain('literal');
  });
});
