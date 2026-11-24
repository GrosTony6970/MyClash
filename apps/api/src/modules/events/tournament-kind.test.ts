/**
 * A Tournament's kind of entrant, checked against the kind in force (`tournament-kind.ts`).
 *
 * The story: Lyon opens "Team Longsword". A team Tournament has no waitlist and takes no forfeit
 * rules (ruling 972 governs a team's cards); an individual one has no team size. A switch of kind
 * clears the column the other kind owns.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertFitsKind,
  countTournamentEntrants,
  kindColumnsOfSave,
  kindInForce,
} from './tournament-kind';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';

/** The 400's body, or null when the body fits. */
function refusalOf(...args: Parameters<typeof assertFitsKind>) {
  try {
    assertFitsKind(...args);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
}

describe('assertFitsKind', () => {
  it('refuses a waitlist cap on a team Tournament', () => {
    expect(refusalOf('team', { maxWaitlist: 4 })).toEqual({
      code: 'entrant_kind_field',
      field: 'maxWaitlist',
      message: 'A team Tournament has no waitlist.',
    });
    expect(refusalOf('team', { maxWaitlist: 0 })).toMatchObject({ field: 'maxWaitlist' });
  });

  it("accepts a team Tournament's cleared waitlist cap, as the Basics save sends it", () => {
    expect(refusalOf('team', { maxWaitlist: null })).toBeNull();
    expect(refusalOf('team', {})).toBeNull();
  });

  it('refuses any forfeit rules on a team Tournament, even an empty change', () => {
    expect(refusalOf('team', { forfeitRules: {} })).toEqual({
      code: 'entrant_kind_field',
      field: 'forfeitRules',
      message: 'The forfeit rules do not act on a team Tournament.',
    });
  });

  it('refuses a team size on an individual Tournament, and accepts it cleared', () => {
    expect(refusalOf('individual', { teamDefaultSize: 3 })).toMatchObject({
      field: 'teamDefaultSize',
    });
    expect(refusalOf('individual', { teamDefaultSize: null })).toBeNull();
  });

  it("accepts an individual Tournament's waitlist and forfeit rules, and a team's size", () => {
    expect(refusalOf('individual', { maxWaitlist: 4, forfeitRules: {} })).toBeNull();
    expect(refusalOf('team', { teamDefaultSize: 3 })).toBeNull();
  });
});

describe('kindInForce', () => {
  it("is the body's kind when it sends one, else the stored one", () => {
    expect(kindInForce('team', { entrantKind: 'individual' })).toBe('individual');
    expect(kindInForce('individual', { entrantKind: 'team' })).toBe('team');
    expect(kindInForce('team', {})).toBe('team');
    expect(kindInForce('individual', {})).toBe('individual');
  });
});

describe('kindColumnsOfSave', () => {
  it('clears the waitlist cap on a switch to team', () => {
    expect(kindColumnsOfSave('individual', { entrantKind: 'team', teamDefaultSize: 3 })).toEqual({
      entrant_kind: 'team',
      team_default_size: 3,
      max_waitlist: null,
    });
  });

  it('clears the team size on a switch to individual', () => {
    expect(kindColumnsOfSave('team', { entrantKind: 'individual' })).toEqual({
      entrant_kind: 'individual',
      team_default_size: null,
    });
  });

  it('clears nothing when the kind sent is the stored one', () => {
    expect(kindColumnsOfSave('team', { entrantKind: 'team' })).toEqual({ entrant_kind: 'team' });
    expect(kindColumnsOfSave('individual', { entrantKind: 'individual' })).toEqual({
      entrant_kind: 'individual',
    });
  });

  it('writes a team size alone, and nothing for a body without kind fields', () => {
    expect(kindColumnsOfSave('team', { teamDefaultSize: 5 })).toEqual({ team_default_size: 5 });
    expect(kindColumnsOfSave('team', { maxWaitlist: null })).toEqual({});
  });
});

describe('countTournamentEntrants', () => {
  it('counts every Registration whatever its status, and every team, of this Tournament only', async () => {
    const db = mockSupabase({
      registrations: {
        rows: [
          { id: 'r1', tournament_id: 't1', status: 'registered' },
          { id: 'r2', tournament_id: 't1', status: 'checked_in' },
          { id: 'r3', tournament_id: 't1', status: 'waitlist' },
          { id: 'r4', tournament_id: 't1', status: 'withdrawn' },
          { id: 'r5', tournament_id: 't1', status: 'disqualified' },
          { id: 'r6', tournament_id: 't2', status: 'registered' },
        ],
      },
      teams: {
        rows: [
          { id: 'tm1', tournament_id: 't1' },
          { id: 'tm2', tournament_id: 't2' },
        ],
      },
    });

    expect(await countTournamentEntrants(db.service as never, 't1')).toBe(6);
    expect(selectsFor(db.from, 'registrations')).toEqual(['id']);
    expect(selectsFor(db.from, 'teams')).toEqual(['id']);
    expect(filtersFor(db.from, 'registrations', 'eq')).toEqual([['tournament_id', 't1']]);
  });

  it('refuses with the error a count answered', async () => {
    const db = mockSupabase({
      registrations: { data: null, error: { message: 'boom' } },
      teams: { rows: [] },
    });
    await expect(countTournamentEntrants(db.service as never, 't1')).rejects.toThrow('boom');
  });
});
