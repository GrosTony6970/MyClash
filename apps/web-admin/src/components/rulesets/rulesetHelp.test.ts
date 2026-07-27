import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';
import { RULESET_HELP_KEYS, rulesetHelp, rulesetHelpKey, type RulesetHelpKey } from './rulesetHelp';

function resolve(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, part) => {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    return (cursor as Record<string, unknown>)[part];
  }, tree);
}

describe('rulesetHelpKey', () => {
  it('maps a concept to its full literal key', () => {
    expect(rulesetHelpKey('formula')).toBe('admin.rulesets.deepHelp.formula');
  });

  it('gives every concept a distinct key', () => {
    const keys = RULESET_HELP_KEYS.map(rulesetHelpKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('rulesetHelp', () => {
  it('passes the key straight to the translator', () => {
    expect(rulesetHelp('tiebreakers', (key) => `<<${key}>>`)).toBe(
      '<<admin.rulesets.deepHelp.tiebreakers>>',
    );
  });
});

describe('every concept resolves in both locales', () => {
  // The i18n reverse sweep catches a key with no reference; it does not catch
  // a reference whose key was never written. This is the other direction.
  it.each(RULESET_HELP_KEYS)('%s has EN and FR copy', (key: RulesetHelpKey) => {
    const path = rulesetHelpKey(key);
    expect(typeof resolve(en, path)).toBe('string');
    expect(typeof resolve(fr, path)).toBe('string');
  });

  it('says something substantial, not a placeholder', () => {
    for (const key of RULESET_HELP_KEYS) {
      const text = resolve(en, rulesetHelpKey(key));
      expect(typeof text).toBe('string');
      expect((text as string).length).toBeGreaterThan(40);
    }
  });
});
