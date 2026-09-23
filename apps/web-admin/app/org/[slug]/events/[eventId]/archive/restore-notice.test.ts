import { describe, expect, it } from 'vitest';
import { createTranslator, en, fr } from '@myclash/i18n';
import { restoredNotice } from './restore-notice';

/**
 * The archive page's success line names the penalty ruleset pins a restore
 * cleared (operator ruling 67), in both languages.
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
});
