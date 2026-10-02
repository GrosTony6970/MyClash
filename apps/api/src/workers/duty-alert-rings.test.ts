/**
 * Is a referee duty's "starting soon" set? (operator ruling 221)
 *
 * Paul referees Pool 3, which starts at 10:00. An alert that rang does not ring again for the same
 * start; a start that moved rings at the new time; a duty that has started rings for nobody. The
 * memory is the alert that fired, kept in the queue with the start it was set for.
 */
import { describe, expect, it } from 'vitest';
import {
  ALERT_DROPPED,
  ALERT_SENT,
  dutyAlertStep,
  hasFired,
  type HeldAlert,
} from './duty-alert-rings';

const at = (hhmm: string) => `2026-05-02T${hhmm}:00.000Z`;
const START = at('10:00');
const NOW = new Date(at('09:55'));

const waiting = (startsAt = START): HeldAlert => ({ data: { startsAt } });
const fired = (returnvalue: unknown, startsAt: string | null = START): HeldAlert => ({
  finishedOn: 1,
  returnvalue,
  data: { startsAt },
});

describe('an alert that rang does not ring again for the same start', () => {
  it('keeps the record of an alert that was sent', () => {
    expect(dutyAlertStep(START, NOW, fired(ALERT_SENT))).toBe('keep');
  });

  it('counts an alert that failed as sent: the live phones rang before the dead one threw', () => {
    expect(dutyAlertStep(START, NOW, fired(null))).toBe('keep');
  });

  it('reads the start as an instant, however it is written', () => {
    expect(dutyAlertStep(START, NOW, fired(ALERT_SENT, '2026-05-02T12:00:00+02:00'))).toBe('keep');
  });
});

describe('an alert is set when nobody was told of this start', () => {
  it.each<[string, HeldAlert | null | undefined]>([
    ['nothing is held: it was never set', null],
    ['nothing is held, as the queue says it', undefined],
    ['it still waits: it moves with the duty', waiting(at('14:00'))],
    ['it was dropped at its minute: a draft, or an unlocked board', fired(ALERT_DROPPED)],
    ['it rang for another start: the duty moved', fired(ALERT_SENT, at('09:58'))],
    ['it failed for another start', fired(null, at('09:58'))],
    ['it fired with no start in its data: no memory', fired(ALERT_SENT, null)],
  ])('when %s', (_, held) => {
    expect(dutyAlertStep(START, NOW, held)).toBe('set');
  });
});

describe('a duty that has started rings for nobody', () => {
  it.each<[string, HeldAlert | null]>([
    ['nothing is held', null],
    ['an alert still waits', waiting()],
    ['an alert rang for it', fired(ALERT_SENT)],
  ])('an hour after its start, when %s', (_, held) => {
    expect(dutyAlertStep(START, new Date(at('11:00')), held)).toBe('remove');
  });

  it('nor at the second it starts', () => {
    expect(dutyAlertStep(START, new Date(START), null)).toBe('remove');
  });

  it('is still set a second before', () => {
    expect(dutyAlertStep(START, new Date('2026-05-02T09:59:59.000Z'), null)).toBe('set');
  });
});

describe('a job that fired, and one that still waits', () => {
  it('has fired once the queue stamped its end', () => {
    expect(hasFired(fired(ALERT_SENT))).toBe(true);
    expect(hasFired(fired(null))).toBe(true);
  });

  it('still waits before that, and nothing held has not fired', () => {
    expect(hasFired(waiting())).toBe(false);
    expect(hasFired(null)).toBe(false);
  });
});
