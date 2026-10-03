import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `failureMessage` says the archived-Event refusal in the reader's language
 * (ruling 234), but only where a screen reaches it. A screen that gives every
 * 403 its own meaning must rule the archived refusal out first: the Tournament
 * settings read it as "bouts are scored" and opened the re-pin dialog, then
 * said "only the ruleset's owner". The tab is too large to mount, so its two
 * 403 branches are pinned as text.
 */
const BASICS_TAB = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'app',
    'org',
    '[slug]',
    'events',
    '[eventId]',
    'tournaments',
    '[tournamentId]',
    'settings',
    '_components',
    'BasicsTab.tsx',
  ),
  'utf8',
);

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('the Tournament settings give a 403 their own meaning only when the Event is not archived', () => {
  it('rules the archived refusal out at both 403 branches', () => {
    expect(count(BASICS_TAB, 'r.status === 403')).toBe(2);
    expect(count(BASICS_TAB, 'r.status === 403 && !isArchivedEventRefusal(r)')).toBe(2);
  });
});
