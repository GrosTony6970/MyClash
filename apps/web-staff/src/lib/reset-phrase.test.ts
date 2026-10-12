/**
 * The words typed before a bout is reset are read loosely, and the pad sends
 * the exact words itself (quick win P9; operator, 2026-10-12).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESET_PHRASE, resetPhraseTyped } from './reset-phrase';

const component = (name: string) => readFileSync(join(__dirname, '..', 'components', name), 'utf8');

describe('the words typed before a reset', () => {
  it.each([
    'RESET MATCH',
    'reset match',
    'Reset Match',
    '  RESET MATCH ',
    'reset  match',
    'RESET\tMATCH',
  ])('takes %j', (typed) => {
    expect(resetPhraseTyped(typed)).toBe(true);
  });

  it.each(['', 'RESET', 'RESETMATCH', 'RESET MATCH now', 'RÉINITIALISER', 'reset the match'])(
    'does not take %j',
    (typed) => {
      expect(resetPhraseTyped(typed)).toBe(false);
    },
  );

  it('are the words the server compares with', () => {
    const service = readFileSync(
      join(__dirname, '..', '..', '..', 'api', 'src', 'modules', 'matches', 'matches.service.ts'),
      'utf8',
    );
    expect(service).toContain(`if (dto.confirmation !== '${RESET_PHRASE}') {`);
  });
});

describe('the reset zone of the corrections drawer', () => {
  it('sends the exact words, never what was typed', () => {
    const drawer = component('MatchCorrectionsDrawer.tsx');
    expect(drawer).toContain('confirmation: RESET_PHRASE,');
    expect(drawer).not.toContain('resetText');
  });

  it('arms its button on the loose reading, and says why it is not armed', () => {
    const zone = component('ResetMatchZone.tsx');
    expect(zone).toContain('const ready = resetPhraseTyped(typed);');
    expect(zone).toContain('disabled={disabled || !ready}');
    expect(zone).toContain("{t('scoring.corrections.resetPhraseMissing')}");
  });

  it('is emptied by a reset the server took, and lives only while the drawer is open', () => {
    const zone = component('ResetMatchZone.tsx');
    expect(zone).toContain("if (await onReset()) setTyped('');");
    // The words typed are the zone's own state: the drawer draws nothing while shut.
    const drawer = component('MatchCorrectionsDrawer.tsx');
    expect(drawer.indexOf('if (!open) return null;')).toBeLessThan(
      drawer.indexOf('<ResetMatchZone'),
    );
  });
});
