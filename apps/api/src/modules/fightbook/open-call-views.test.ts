import { describe, expect, it } from 'vitest';
import { callIsOpen, callState, callTime, myAnswerOn, type OpenCallRow } from './open-call-views';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const NOW = new Date('2026-05-23T18:00:00Z');

const call = (over: Partial<OpenCallRow> = {}): OpenCallRow => ({
  id: 'c1',
  poster_global_person_id: 'p1',
  weapons: ['Longsword'],
  spar_time: '15:00:00',
  status: 'open',
  picked_global_person_id: null,
  closes_at: '2026-05-23T19:00:00+00:00',
  ...over,
});
const PAST = '2026-05-23T17:59:59+00:00';
const AT_NOW = '2026-05-23T18:00:00+00:00';

describe('callIsOpen: status open AND closes_at later than now (Decision 5)', () => {
  it.each<[string, Partial<OpenCallRow>, boolean]>([
    ['open, closing later', {}, true],
    ['open, closing now', { closes_at: AT_NOW }, false],
    ['open, closed by its time', { closes_at: PAST }, false],
    ['closed by its poster', { status: 'closed' }, false],
    ['picked', { status: 'picked', picked_global_person_id: PAUL }, false],
  ])('%s: %s', (_, over, open) => {
    expect(callIsOpen(call(over), NOW)).toBe(open);
  });
});

describe('callState: what the poster sees', () => {
  it.each<[string, Partial<OpenCallRow>, string]>([
    ['open', {}, 'open'],
    ['open past its time', { closes_at: PAST }, 'closed'],
    ['closed', { status: 'closed' }, 'closed'],
    ['picked', { status: 'picked', picked_global_person_id: PAUL }, 'picked'],
  ])('%s reads %s', (_, over, state) => {
    expect(callState(call(over), NOW)).toBe(state);
  });
});

describe('myAnswerOn: where the caller stands on someone else’s call (ruling 706)', () => {
  it.each<[string, Partial<OpenCallRow>, boolean, string]>([
    ['not answered, open', {}, false, 'none'],
    ['not answered, closed', { status: 'closed' }, false, 'none'],
    [
      'not answered, picked another',
      { status: 'picked', picked_global_person_id: PAUL },
      false,
      'none',
    ],
    ['answered, open', {}, true, 'in'],
    ['answered, past its time', { closes_at: PAST }, true, 'not_this_time'],
    ['answered, closed by the poster', { status: 'closed' }, true, 'not_this_time'],
    [
      'answered, another picked',
      { status: 'picked', picked_global_person_id: PAUL },
      true,
      'not_this_time',
    ],
    ['answered, picked me', { status: 'picked', picked_global_person_id: MARC }, true, 'picked'],
    // A take-back that waited on the pick's lock lands after it: the spar is still mine.
    [
      'answer taken back after the pick',
      { status: 'picked', picked_global_person_id: MARC },
      false,
      'picked',
    ],
  ])('%s reads %s', (_, over, answered, answer) => {
    expect(myAnswerOn(call(over), MARC, answered, NOW)).toBe(answer);
  });
});

describe('callTime', () => {
  it('reads the wall time as HH:MM', () => {
    expect(callTime('15:00:00')).toBe('15:00');
    expect(callTime('09:05')).toBe('09:05');
  });
});
