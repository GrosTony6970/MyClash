import { describe, expect, it } from 'vitest';
import { cardSessions } from './card-sessions';

// "Longsword basics": Saturday 10:00 (cancelled), Saturday 14:00, Sunday 10:00, and one undated.
const sessions = [
  { id: 'sun', startsAt: '2027-05-23T08:00:00Z', status: 'scheduled' },
  { id: 'sat-am', startsAt: '2027-05-22T08:00:00Z', status: 'cancelled' },
  { id: 'sat-pm', startsAt: '2027-05-22T12:00:00Z' },
  { id: 'undated', startsAt: null },
];

describe('cardSessions', () => {
  it('speaks of the sessions that run, a cancelled one on its own line (ruling 526)', () => {
    const card = cardSessions(sessions, false);
    expect(card.first?.id).toBe('sat-pm');
    expect(card.more).toBe(1);
    expect(card.live.map((s) => s.id)).toEqual(['sun', 'sat-pm', 'undated']);
    expect(card.cancelled.map((s) => s.id)).toEqual(['sat-am']);
  });

  it('leaves the cancelled line to a footer that lists every session', () => {
    expect(cardSessions(sessions, true).cancelled).toEqual([]);
  });

  it('gives a Workshop whose every session was cancelled no time line, only its struck lines', () => {
    const card = cardSessions(
      [{ id: 'sat', startsAt: '2027-05-22T08:00:00Z', status: 'cancelled' }],
      false,
    );
    expect([card.first, card.more, card.live]).toEqual([null, 0, []]);
    expect(card.cancelled.map((s) => s.id)).toEqual(['sat']);
  });
});
