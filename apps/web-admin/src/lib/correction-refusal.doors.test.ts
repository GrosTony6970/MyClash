import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';

/**
 * `correctionRefusal` knows the refusals by their `code`; a screen that asks
 * `failureMessage` alone shows the API's English sentence instead. The pages are
 * too large to mount, so each door that can change a bout's result is pinned as
 * text: its failed call goes through `correctionFailureMessage`.
 */
const EVENT_ROOT = join(__dirname, '..', '..', 'app', 'org', '[slug]', 'events', '[eventId]');
const BRACKET_PAGE = readFileSync(join(EVENT_ROOT, 'bracket', 'page.tsx'), 'utf8');
const BOUT_PAGE = readFileSync(join(EVENT_ROOT, 'matches', '[matchId]', 'page.tsx'), 'utf8');

describe('the doors that change a bout’s result say a refusal in the reader’s language', () => {
  it.each<[string, string, string]>([
    ['a forfeit from the bracket', BRACKET_PAGE, "t('admin.common.forfeitFailed')"],
    ['a forfeit from the bout page', BOUT_PAGE, "t('admin.common.forfeitFailed')"],
    ['a forfeit’s void', BOUT_PAGE, "t('organizer.bracketPage.voidRecordFailed')"],
    ['a reopen', BOUT_PAGE, "t('admin.common.couldNotReopenMatch')"],
    ['an Exchange’s void', BOUT_PAGE, "t('admin.common.voidFailed')"],
    ['an Exchange’s restore', BOUT_PAGE, "t('admin.common.revertFailed')"],
  ])('%s', (_door, page, fallback) => {
    expect(page).toContain(`correctionFailureMessage(r, t, ${fallback})`);
    // Lower-case `f`: the bare api-client helper, which the line above does not contain.
    expect(page).not.toContain(`failureMessage(r, t, ${fallback})`);
  });
});

describe('a correction sent for review', () => {
  // The sentence carried the request's raw id, which names nothing to its reader.
  it('is said with no id, by the void and by the restore', () => {
    expect(BOUT_PAGE.split("setPendingNotice(t('organizer.matchDetail.correctionSubmitted'));"))
      // Two doors: three parts.
      .toHaveLength(3);
    expect(BOUT_PAGE).not.toContain('requestId');
    expect(en.organizer.matchDetail.correctionSubmitted).toBe(
      'Correction request submitted for review.',
    );
    expect(fr.organizer.matchDetail.correctionSubmitted).toBe(
      'Demande de correction soumise pour validation.',
    );
  });
});
