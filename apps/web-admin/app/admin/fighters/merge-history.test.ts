import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator, getMessages } from '@myclash/i18n';
import { describe, expect, it } from 'vitest';

/**
 * The merge history says how many follows moved (operator ruling 125). A merge moves the directory
 * follows of the merged-away profile to the survivor (ruling 116), and its record keeps whose; the
 * history showed people, registrations and instructors only.
 *
 * The page is read as text: rendering the whole fighters admin for one line costs more than it pins.
 */
describe('the fighter merge history', () => {
  it('counts the follows a merge moved', () => {
    const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(page).toMatch(
      /follows:\s+audit\.payload_json\.moved\?\.directoryFollowerUserIds\?\.length \?\? 0,/,
    );
  });

  it.each(['en', 'fr'] as const)('the %s summary shows the count', (locale) => {
    const t = createTranslator(getMessages(locale));
    const line = t('admin.globalProfiles.merge.movedSummary', {
      persons: 1,
      registrations: 0,
      instructors: 0,
      follows: 7,
    });
    expect(line).toContain('7');
    expect(line).not.toContain('{follows}');
  });
});
