import { describe, expect, it } from 'vitest';
import { joinOffer } from './join-event';

/** A Workshop page offers the join only at an Event that allows it, once its read is in (516). */
describe('joinOffer', () => {
  it('offers the join at an Event that lets people join by themselves', () => {
    expect(joinOffer({ id: 'ev-1', workshopSelfJoin: true }, 'http://api.test')).toEqual({
      apiUrl: 'http://api.test',
      eventId: 'ev-1',
    });
  });

  it('offers nothing at an Event that does not, or before its read is in', () => {
    expect(joinOffer({ id: 'ev-1', workshopSelfJoin: false }, 'http://api.test')).toBe(null);
    expect(joinOffer(null, 'http://api.test')).toBe(null);
  });
});
