import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { canTick, checkInRefusal } from './roster-check-in';

/**
 * A tick refused by the server, said in the reader's words (rulings 539-545). The roster was open
 * while the session was cancelled, or the instructor refused the person since: each refusal has
 * its own sentence, never another box's (the message box's cancelled sentence speaks of messages).
 */
const t = (key: string) => key;
const refused = (code: string, status = 409): ApiFailure =>
  ({
    ok: false,
    kind: 'http',
    status,
    code,
    message: 'English from the server',
  }) as unknown as ApiFailure;

describe('the words of a refused tick', () => {
  it.each([
    ['CHECK_IN_REFUSED_BOOKING', 'organizer.workshopsPage.checkInRefused'],
    ['WORKSHOP_SESSION_CANCELLED', 'organizer.workshopsPage.checkInCancelled'],
    ['NOT_FOUND', 'organizer.workshopsPage.checkInGone'],
  ])('says %s with its own sentence', (code, key) => {
    expect(checkInRefusal(refused(code), t)).toBe(key);
  });

  it('draws a box for a seat and a waiting-list place only (541)', () => {
    expect(['confirmed', 'waitlisted', 'refused', 'intent'].map(canTick)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
