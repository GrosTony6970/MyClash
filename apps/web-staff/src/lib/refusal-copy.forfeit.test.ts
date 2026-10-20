import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import { refusalMessage } from './refusal-copy';

/**
 * A forfeit the server refuses because the Tournament's forfeit rules do not parse (a hand-edited
 * archive, rulings 63-76): the pad's forfeit panel says so in the referee's language, never the
 * API's English.
 */
const t = (key: string) => key;

const refused: ApiFailure = {
  kind: 'http',
  status: 409,
  detail: 'The forfeit rules of this Tournament cannot be read: fix its penalty ruleset',
  code: 'forfeit_rules_invalid',
  details: null,
  validationErrors: null,
};

describe('a forfeit refused on rules that do not parse', () => {
  it('reads in the pad’s words, in en and fr', () => {
    expect(refusalMessage(refused, t, 'scoring.forfeits.recordError')).toBe(
      'scoring.forfeits.rulesInvalid',
    );
    expect(en.scoring.forfeits.rulesInvalid).toContain('forfeit rules');
    expect(fr.scoring.forfeits.rulesInvalid).toContain('règles de forfait');
  });
});
