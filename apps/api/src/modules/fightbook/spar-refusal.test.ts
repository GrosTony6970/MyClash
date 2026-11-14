import { HttpException, Logger } from '@nestjs/common';
import { SPAR_REFUSAL_CODES, type SparRefusalCode } from '@myclash/types';
import { describe, expect, it, vi } from 'vitest';
import { databaseRefusal } from './spar-requests.service';
import { notOpen } from './spar-side';

/** Written out on purpose: word, status, sentence. A swap of two rows turns this red. */
const EXPECTED: Record<SparRefusalCode, [number, string]> = {
  no_profile: [403, 'FightBook needs a fighter profile'],
  fightbook_off: [403, 'Switch FightBook on first'],
  not_on_fightbook: [403, 'This fighter does not use FightBook'],
  already_asked: [409, 'You already asked this fighter. Wait for their answer'],
  not_again: [409, 'This fighter said "not this time". You cannot ask again for now'],
  you_blocked: [403, 'You blocked this fighter. Unblock them first'],
  not_open: [409, 'This request is no longer open'],
  bad_day: [400, 'That day cannot be chosen'],
  bad_zone: [400, 'Your time zone could not be read'],
  bad_place: [400, 'Pick a place for a free date'],
  bad_weapon: [400, 'That weapon is not on the list'],
  bad_event: [400, 'This code works only at a public Event you are both at, on a day it runs'],
  bad_answer: [400, 'That answer is not possible'],
  self: [400, 'You cannot ask yourself'],
  favourites_full: [409, 'Your favourites list is full'],
  too_many_calls: [
    400,
    'You have the most open calls you can have today. Close one to post another',
  ],
  bad_time: [400, 'Choose a time later today, before the Event day ends'],
  bad_code: [400, 'This code has expired or was already used — ask them to show it again'],
};

describe('databaseRefusal', () => {
  it.each(SPAR_REFUSAL_CODES)('%s answers its code, its status and its sentence', (word) => {
    const error = databaseRefusal({ code: 'P0001', message: word }, 'x');
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    const [status, sentence] = EXPECTED[word];
    expect(http.getStatus()).toBe(status);
    expect(http.getResponse()).toMatchObject({ code: word, message: sentence });
  });

  it('answers a word no code names as 403 with the word as its message, and logs it', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const http = databaseRefusal({ code: 'P0001', message: 'mystery' }, 'ask') as HttpException;
    expect(http.getStatus()).toBe(403);
    expect(http.getResponse()).toMatchObject({ code: 'mystery', message: 'mystery' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^ask: .*mystery$/);
    warn.mockClear();
    databaseRefusal({ code: 'P0001', message: 'not_open' }, 'ask');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not index the list with an inherited name', () => {
    const http = databaseRefusal({ code: 'P0001', message: 'toString' }, 'x') as HttpException;
    expect(http.getResponse()).toMatchObject({ message: 'toString' });
  });

  it('turns an error that is not a refusal into a plain Error', () => {
    const error = databaseRefusal({ code: '23505', message: 'duplicate' }, 'ask');
    expect(error).not.toBeInstanceOf(HttpException);
    expect(error.message).toBe('ask failed: duplicate');
  });
});

describe('notOpen', () => {
  it('says the same sentence as the list', () => {
    expect(notOpen().getResponse()).toEqual({
      code: 'not_open',
      message: EXPECTED.not_open[1],
    });
  });
});
