import { describe, expect, it } from 'vitest';
import type { IncomingSparRequest } from '@myclash/types';
import {
  answered,
  blocked,
  markedDone,
  noted,
  reviewed,
  starsShown,
  undone,
} from './fightbook-patches';
import type { FightBookData } from './use-fightbook';

/**
 * A re-read can land between a write and its answer: Julie's Yes is saved, the page reads again
 * (the spar is in My spars already), then the Yes answer patches the page. The patch must not add
 * the spar, or the fighter Julie blocked, a second time.
 */
const marc = {
  globalPersonId: '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01',
  name: 'Marc',
  photoUrl: null,
  club: null,
};
const request: IncomingSparRequest = {
  id: 'r-1',
  asker: marc,
  kind: 'free',
  eventName: null,
  day: '2026-05-23',
  time: null,
  place: 'Salle',
  weapons: ['Longsword'],
  message: null,
  markFrom: '2026-05-22T22:00:00.000Z',
  markUntil: '2026-05-26T04:00:00.000Z',
  cancelUntil: '2026-05-24T04:00:00.000Z',
};
const empty: FightBookData = {
  settings: { hasProfile: true, enabled: true },
  inbox: [request],
  spars: { spars: [], sent: [] },
  blocks: [],
};
const apply = (data: FightBookData, patch: (d: FightBookData) => Partial<FightBookData>) => ({
  ...data,
  ...patch(data),
});

describe('the list patches', () => {
  it('a Yes the page already read back is not added twice', () => {
    const once = apply(empty, answered(request, 'agreed'));
    const twice = apply(once, answered(request, 'agreed'));
    expect(twice.spars.spars.map((s) => s.id)).toEqual(['r-1']);
    expect(twice.inbox).toEqual([]);
  });

  it('a Yes makes a card with the request’s windows and nothing written on it yet', () => {
    const [card] = apply(empty, answered(request, 'agreed')).spars.spars;
    expect(card).toMatchObject({
      markFrom: request.markFrom,
      markUntil: request.markUntil,
      cancelUntil: request.cancelUntil,
      myReview: null,
      theirThanks: null,
      note: null,
      partnerFavourite: null,
    });
  });

  it('mark, undo, review and note move only a spar in the state they started from', () => {
    const agreed = apply(empty, answered(request, 'agreed'));
    const done = apply(agreed, markedDone('r-1'));
    expect(done.spars.spars[0]?.status).toBe('done');
    // Twice, and on a spar a re-read already moved on: nothing more changes.
    expect(apply(done, markedDone('r-1')).spars.spars).toEqual(done.spars.spars);
    expect(apply(agreed, undone('r-1')).spars.spars).toEqual(agreed.spars.spars);
    expect(apply(agreed, noted('r-1', 'x')).spars.spars[0]?.note).toBeNull();
    expect(
      apply(agreed, reviewed('r-1', { stars: 3, text: null, anonymous: true })).spars.spars[0],
    ).toMatchObject({ myReview: null });
    expect(apply(done, noted('r-1', 'x')).spars.spars[0]?.note).toBe('x');
    expect(
      apply(done, reviewed('r-1', { stars: 3, text: null, anonymous: true })).spars.spars[0],
    ).toMatchObject({ myReview: { stars: 3 } });
    expect(apply(done, undone('r-1')).spars.spars[0]?.status).toBe('agreed');
  });

  it('a saved star switch sets showStars and leaves the rest of the settings', () => {
    const settings = { ...empty.settings, showStars: false, sparred: 3, stars: null };
    const on = apply({ ...empty, settings }, starsShown(true));
    expect(on.settings).toEqual({ ...settings, showStars: true });
    expect(on.inbox).toBe(empty.inbox);
  });

  it('a block the page already read back is not listed twice', () => {
    const twice = apply(apply(empty, blocked(marc)), blocked(marc));
    expect(twice.blocks.map((b) => b.fighter.globalPersonId)).toEqual([marc.globalPersonId]);
  });
});
