import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `failureMessage` says the archived-Event refusal in the reader's language
 * (ruling 234), but only where a screen reaches it. A screen that gives every
 * 403 its own meaning must rule the archived refusal out first: the Tournament
 * settings read it as "bouts are scored" and opened the re-pin dialog, then
 * said "only the ruleset's owner". Since commit 5c the ruleset change opens the
 * re-pin on the lock's CODE alone (`page.rules-change.basics.test.tsx` mounts it),
 * so one uncoded 403 branch is left, the owner bar's, and it is pinned as text.
 */
const EVENT_PAGES = join(__dirname, '..', '..', 'app', 'org', '[slug]', 'events', '[eventId]');
const read = (...path: string[]) => readFileSync(join(EVENT_PAGES, ...path), 'utf8');

const BASICS_TAB = read(
  'tournaments',
  '[tournamentId]',
  'settings',
  '_components',
  'BasicsTab.tsx',
);
const LOGO_CARD = read('_components', 'EventLogoCard.tsx');
const DELETE_MODAL = read('persons', '_components', 'DeleteParticipantModal.tsx');

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('the Tournament settings give a 403 their own meaning only when the Event is not archived', () => {
  it('rules the archived refusal out at its one uncoded 403 branch', () => {
    expect(count(BASICS_TAB, 'r.status === 403')).toBe(1);
    expect(count(BASICS_TAB, 'r.status === 403 && !isArchivedEventRefusal(r)')).toBe(1);
  });
});

/**
 * Both screens grey their buttons on an archived Event, from a status they read
 * when the page opened. An Event archives itself, so a page left open sends the
 * write and gets the refusal. They showed the server's English sentence.
 */
describe('a write refused on a page opened before the Event archived is said by failureMessage', () => {
  it('the Event logo card', () => {
    expect(count(LOGO_CARD, 'failureDetail')).toBe(0);
    expect(count(LOGO_CARD, 'setError(failureMessage(r, t, failedLabel))')).toBe(1);
  });

  it('the roster delete, at both of its doors', () => {
    expect(count(DELETE_MODAL, 'failureDetail')).toBe(0);
    expect(count(DELETE_MODAL, 'throw new Error(backendReason(r, t))')).toBe(2);
    expect(count(DELETE_MODAL, 'failureMessage(failure, t, ')).toBe(1);
  });
});
