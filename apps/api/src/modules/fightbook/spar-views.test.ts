import { describe, expect, it } from 'vitest';
import type { SparFighter } from '@myclash/types';
import {
  effectiveSparStatus,
  NO_EXTRAS,
  toAgreed,
  toIncoming,
  toSent,
  type SparRow,
} from './spar-views';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const NOW = new Date('2026-05-22T12:00:00Z');
const julie: SparFighter = {
  globalPersonId: JULIE,
  name: 'Julie Probe',
  photoUrl: null,
  club: null,
};
const marc: SparFighter = {
  globalPersonId: MARC,
  name: 'Marc Probe',
  photoUrl: 'm.jpg',
  club: 'Club A',
};

const row = (over: Partial<SparRow> = {}): SparRow => ({
  id: 'r-1',
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  kind: 'event',
  event_id: 'e-1',
  spar_day: '2026-05-23',
  zone: 'Europe/Paris',
  spar_time: '18:30:00',
  place: null,
  weapons: ['Longsword'],
  message: 'After the Pools?',
  status: 'pending',
  expires_at: '2026-05-24T04:00:00+00:00',
  shared_comment: null,
  cancelled_by: null,
  cancel_message: null,
  ...over,
});

describe('effectiveSparStatus', () => {
  it('reads a waiting request past its end as a no', () => {
    expect(effectiveSparStatus(row({ expires_at: '2026-05-22T11:59:00Z' }), NOW)).toBe(
      'not_this_time',
    );
    expect(effectiveSparStatus(row(), NOW)).toBe('pending');
    expect(effectiveSparStatus(row({ status: 'agreed' }), NOW)).toBe('agreed');
  });
});

describe('toSent: what the asker sees', () => {
  it('gives one payload for every kind of "Not this time"', () => {
    const declined = row({ id: 'a', status: 'not_this_time' });
    const blocked = row({ id: 'b', status: 'not_this_time' });
    const swept = row({ id: 'c', status: 'not_this_time', expires_at: '2026-05-21T04:00:00Z' });
    const unswept = row({ id: 'd', status: 'pending', expires_at: '2026-05-21T04:00:00Z' });
    const shown = [declined, blocked, swept, unswept].map((r) => {
      const { id: _id, ...rest } = toSent(r, julie, 'Probe Open', NOW);
      return JSON.stringify(rest);
    });
    expect(new Set(shown).size).toBe(1);
    expect(JSON.parse(shown[0]!)).toMatchObject({ status: 'not_this_time', comment: null });
  });

  it('shows the decliner’s comment only when they shared it', () => {
    const view = toSent(
      row({ status: 'not_this_time', shared_comment: 'Next Event!' }),
      julie,
      null,
      NOW,
    );
    expect(view.comment).toBe('Next Event!');
  });

  it('says the day, the time as HH:MM, the Event and the weapons', () => {
    expect(toSent(row(), julie, 'Probe Open', NOW)).toEqual({
      id: 'r-1',
      receiver: julie,
      kind: 'event',
      eventName: 'Probe Open',
      day: '2026-05-23',
      time: '18:30',
      place: null,
      weapons: ['Longsword'],
      message: 'After the Pools?',
      status: 'pending',
      comment: null,
    });
  });
});

// Saturday 23 May 2026 in Paris: the day opens Friday 22:00Z and ends Sunday 04:00Z.
const PARIS_WINDOWS = {
  markFrom: '2026-05-22T22:00:00.000Z',
  markUntil: '2026-05-26T04:00:00.000Z',
  cancelUntil: '2026-05-24T04:00:00.000Z',
};

describe('toIncoming: what the fighter asked sees', () => {
  it('carries the asker, the day, the message and the windows a Yes makes a spar card of', () => {
    expect(toIncoming(row({ event_id: null }), marc, null)).toEqual({
      id: 'r-1',
      asker: marc,
      kind: 'event',
      eventName: null,
      day: '2026-05-23',
      time: '18:30',
      place: null,
      weapons: ['Longsword'],
      message: 'After the Pools?',
      ...PARIS_WINDOWS,
    });
  });
});

describe('toAgreed: a spar both said yes to', () => {
  it('says who asked, and who cancelled', () => {
    const cancelled = row({
      status: 'cancelled',
      cancelled_by: 'receiver',
      cancel_message: 'Injured, sorry',
    });
    expect(toAgreed(cancelled, MARC, julie, null, NO_EXTRAS)).toMatchObject({
      partner: julie,
      iAsked: true,
      status: 'cancelled',
      cancelledByMe: false,
      cancelMessage: 'Injured, sorry',
    });
    expect(toAgreed(cancelled, JULIE, marc, null, NO_EXTRAS)).toMatchObject({
      iAsked: false,
      cancelledByMe: true,
    });
    expect(toAgreed(row({ status: 'agreed' }), MARC, julie, null, NO_EXTRAS)).toMatchObject({
      status: 'agreed',
      cancelledByMe: null,
    });
  });

  it('maps the three statuses My spars reads, and throws on any other', () => {
    for (const status of ['agreed', 'cancelled', 'done'] as const) {
      expect(toAgreed(row({ status }), MARC, julie, null, NO_EXTRAS).status).toBe(status);
    }
    for (const status of ['pending', 'not_this_time', 'withdrawn'] as const) {
      expect(() => toAgreed(row({ status }), MARC, julie, null, NO_EXTRAS)).toThrow(
        `spar card built from a ${status} request`,
      );
    }
  });

  it('carries a done spar, its windows, what was written on it, and no heart yet', () => {
    const extras = {
      myReview: { stars: 5, text: 'Great bout', anonymous: false },
      theirThanks: { stars: 4, text: null },
      note: 'Guard up',
    };
    expect(toAgreed(row({ status: 'done' }), MARC, julie, 'Probe Open', extras)).toEqual({
      id: 'r-1',
      partner: julie,
      iAsked: true,
      kind: 'event',
      eventName: 'Probe Open',
      day: '2026-05-23',
      time: '18:30',
      place: null,
      weapons: ['Longsword'],
      message: 'After the Pools?',
      status: 'done',
      cancelledByMe: null,
      cancelMessage: null,
      ...PARIS_WINDOWS,
      ...extras,
      partnerFavourite: null,
    });
  });
});
