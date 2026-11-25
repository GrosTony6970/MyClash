import { describe, expect, it } from 'vitest';
import { poolSeatOf } from './pool-seat';

/**
 * A Pool seat as the Pools page reads it. The page seats a team by `teamId`, a Fighter by
 * `registrationId`, and takes either out of its Pool by the side key: a seat always names one.
 */
const LYON = { id: 'team-lyon', name: 'Lyon Blades', color: 'green', logo_url: null };
const ANNA = {
  id: 'reg-anna',
  persons: {
    given_name: 'Anna',
    family_name: 'Martin',
    clubs: { name: 'Salle Nord' },
    hema_ratings_id: null,
    global_persons: null,
  },
};

describe('poolSeatOf', () => {
  it('keys a team seat by its team id, with no Registration and no person', () => {
    expect(poolSeatOf(null, LYON, new Map())).toMatchObject({
      sideId: 'team-lyon',
      kind: 'team',
      registrationId: null,
      name: 'Lyon Blades',
      personName: null,
    });
  });

  it('keys a Fighter seat by its Registration id', () => {
    expect(poolSeatOf(ANNA, null, new Map())).toMatchObject({
      sideId: 'reg-anna',
      kind: 'individual',
      registrationId: 'reg-anna',
      personName: 'Anna Martin',
    });
  });

  it('throws for a seat that names neither a Registration nor a team', () => {
    expect(() => poolSeatOf(null, null, new Map())).toThrow('A Pool seat names no entrant');
  });
});
