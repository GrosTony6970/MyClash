import { describe, expect, it } from 'vitest';
import type { IncomingSparRequest } from '@myclash/types';
import { answered, blocked } from './fightbook-patches';
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

  it('a block the page already read back is not listed twice', () => {
    const twice = apply(apply(empty, blocked(marc)), blocked(marc));
    expect(twice.blocks.map((b) => b.fighter.globalPersonId)).toEqual([marc.globalPersonId]);
  });
});
