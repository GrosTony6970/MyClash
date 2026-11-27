/**
 * Every formula variable has a label and a plain meaning, in EN and FR.
 *
 * The formula editor builds both from template keys
 * (`admin.rulesets.variables.<v>`, `admin.rulesets.variableMeaning.<v>`). The
 * i18n reverse sweep only proves a key is referenced; it cannot see a variable
 * added to `FORMULA_VARIABLE_KEYS` with no copy, which would show the raw key.
 */
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';
import { FORMULA_VARIABLE_KEYS } from '@myclash/rulesets';

function resolve(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, part) => {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    return (cursor as Record<string, unknown>)[part];
  }, tree);
}

describe('formula variable copy', () => {
  it.each(FORMULA_VARIABLE_KEYS)('%s has a label and a meaning in EN and FR', (variable) => {
    for (const tree of [en, fr]) {
      expect(typeof resolve(tree, `admin.rulesets.variables.${variable}`)).toBe('string');
      expect(typeof resolve(tree, `admin.rulesets.variableMeaning.${variable}`)).toBe('string');
    }
  });
});
