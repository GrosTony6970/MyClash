import { describe, expect, it } from 'vitest';
import { createTranslator, en, fr } from '@myclash/i18n';
import { restoredNotice } from './restore-notice';

/**
 * The archive page's success line names the penalty ruleset pins a restore
 * cleared (operator ruling 67) and the compensation settings it dropped
 * (ruling 69), in both languages.
 */
describe('restoredNotice', () => {
  const tEn = createTranslator(en);
  const tFr = createTranslator(fr);

  it('says only that the restore started when no pin was cleared', () => {
    expect(restoredNotice(tEn, { droppedPenaltyRulesetPins: 0 })).toBe('Archive restore started.');
    expect(restoredNotice(tEn, {})).toBe('Archive restore started.');
  });

  it('names how many pins were cleared, in English and French', () => {
    expect(restoredNotice(tEn, { droppedPenaltyRulesetPins: 2 })).toBe(
      'Archive restore started. Penalty rulesets removed: 2. This club may not use them, so the restored copy uses the Event default or the built-in.',
    );
    expect(restoredNotice(tFr, { droppedPenaltyRulesetPins: 1 })).toContain(
      'Règlements de pénalités retirés : 1.',
    );
  });

  it('names dropped compensation settings too, after the penalty pins (ruling 69)', () => {
    const notice = restoredNotice(tEn, {
      droppedPenaltyRulesetPins: 1,
      droppedCompensationPlans: 1,
    });
    expect(notice).toMatch(/^Archive restore started\. Penalty rulesets removed: 1\./);
    expect(notice).toMatch(/ Referee compensation settings removed: 1\. .*choose a plan again\.$/);
    expect(restoredNotice(tFr, { droppedCompensationPlans: 2 })).toBe(
      "Restauration de l'archive lancée. Réglages de compensation des arbitres retirés : 2. Ce club ne peut pas utiliser leur plan de compensation ; choisissez-en un à nouveau.",
    );
  });
});
