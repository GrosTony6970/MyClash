import { describe, expect, it } from 'vitest';
import { mapRosterRow, type ArrivalRow, type RosterPersonRow } from './roster';

function person(over: Partial<RosterPersonRow> & { id: string }): RosterPersonRow {
  return {
    given_name: 'Marie',
    family_name: 'Dubois',
    club_id: null,
    global_person_id: null,
    clubs: null,
    global_persons: null,
    ...over,
  };
}

function arrival(over: Partial<ArrivalRow> = {}): ArrivalRow {
  return {
    person_id: 'p1',
    state: 'present',
    via: 'search',
    marked_at: '2026-08-08T09:12:00.000Z',
    reversed_at: null,
    ...over,
  };
}

describe('mapRosterRow', () => {
  it('derives arrived from state, not from the row existing', () => {
    // The undo path keeps the row (so the reversal has somewhere to record an
    // actor) and flips state to 'absent'. Treating "has a row" as "is here"
    // would make every undo invisible on the desk that just performed it.
    const row = mapRosterRow(person({ id: 'p1' }), arrival({ state: 'absent' }));

    expect(row.arrived).toBe(false);
  });

  it('clears the arrival time and via when the arrival was undone', () => {
    // marked_at survives the undo in the table on purpose. Rendering it anyway
    // would put "arrived 09:12" beside an Absent state on the same row.
    const row = mapRosterRow(
      person({ id: 'p1' }),
      arrival({ state: 'absent', reversed_at: '2026-08-08T09:15:00.000Z' }),
    );

    expect(row.arrivedAt).toBeNull();
    expect(row.via).toBeNull();
  });

  it('treats a person with no arrival row as absent', () => {
    const row = mapRosterRow(person({ id: 'p1' }), null);

    expect(row.arrived).toBe(false);
    expect(row.arrivedAt).toBeNull();
  });

  it('takes the photo from global_persons, which is the only table that has one', () => {
    // Local `persons` has no photo_url column at all — the desk's confirm-the-
    // human affordance depends on the global identity link.
    const row = mapRosterRow(
      person({ id: 'p1', global_persons: { photo_url: 'https://cdn/marie.jpg' } }),
      null,
    );

    expect(row.photoUrl).toBe('https://cdn/marie.jpg');
  });

  it('renders a club-less fighter without inventing a club', () => {
    const row = mapRosterRow(person({ id: 'p1', clubs: null }), null);

    expect(row.clubName).toBeNull();
    expect(row.clubLogoUrl).toBeNull();
  });

  it('leaves next null unless a caller supplies one', () => {
    // The gear table and the QR overlay both take this default: neither shows a
    // schedule, and a gear account has no reason to receive one.
    expect(mapRosterRow(person({ id: 'p1' }), null).next).toBeNull();
  });

  it('carries the next bout through when the desk supplies one', () => {
    const next = {
      scheduledAt: '2026-08-08T10:00:00.000Z',
      liceName: 'Lice 3',
      poolName: 'Pool A',
      tournamentName: 'Longsword Open',
    };

    expect(mapRosterRow(person({ id: 'p1' }), null, next).next).toEqual(next);
  });
});
