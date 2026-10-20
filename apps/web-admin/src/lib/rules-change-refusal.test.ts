import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { createTranslator, en, fr } from '@myclash/i18n';
import { RULES_CHANGE_CODES } from '@myclash/types';
import { rulesChangeRefusal } from './rules-change-refusal';

const english = createTranslator(en);
const french = createTranslator(fr);

const refused = (status: number, code: string | null): ApiFailure =>
  status === 403
    ? { kind: 'unauthenticated', status, detail: 'An English sentence.', code, details: null }
    : {
        kind: 'http',
        status,
        detail: 'An English sentence.',
        code,
        details: null,
        validationErrors: null,
      };

/** The status each code is answered with (`RULES_CHANGE_CODES`' own comments). */
const STATUS: Record<string, number> = {
  rules_change_needs_audit: 403,
  rules_change_closed: 403,
  rules_changed_since_read: 409,
  rules_confirm_mismatch: 400,
  rules_unchanged: 400,
  rules_change_mixed: 400,
  rules_check_unavailable: 503,
  card_change_locked: 403,
  forfeit_rules_locked: 403,
};

describe('rulesChangeRefusal', () => {
  it.each(Object.values(RULES_CHANGE_CODES))('words %s in English and in French', (code) => {
    const failure = refused(STATUS[code]!, code);
    const inEnglish = rulesChangeRefusal(failure, english);
    const inFrench = rulesChangeRefusal(failure, french);
    // A key the catalogue lacks comes back as `[key]`: a worded code is a sentence.
    expect(inEnglish).toMatch(/^[^[].*\.$/);
    expect(inFrench).toMatch(/^[^[].*\.$/);
    expect(inFrench).not.toBe(inEnglish);
  });

  it('gives every code its own words', () => {
    const words = Object.values(RULES_CHANGE_CODES).map((code) =>
      rulesChangeRefusal(refused(STATUS[code]!, code), english),
    );
    expect(new Set(words).size).toBe(words.length);
  });

  it('says the reload words when the rules moved since the page read them', () => {
    expect(rulesChangeRefusal(refused(409, 'rules_changed_since_read'), english)).toBe(
      'The rules of this tournament changed since this page read them. Reload the page and check them again.',
    );
    expect(rulesChangeRefusal(refused(409, 'rules_changed_since_read'), french)).toBe(
      'Les règles de ce tournoi ont changé depuis que cette page les a lues. Rechargez la page et vérifiez-les à nouveau.',
    );
  });

  it('has nothing to say of a failure that carries no rules-change code', () => {
    expect(rulesChangeRefusal(refused(403, 'FORBIDDEN'), english)).toBeNull();
    expect(rulesChangeRefusal(refused(400, null), english)).toBeNull();
    expect(rulesChangeRefusal({ kind: 'network' }, english)).toBeNull();
  });
});
