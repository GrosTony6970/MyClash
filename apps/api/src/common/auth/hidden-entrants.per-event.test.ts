/**
 * A list that spans many Events reads them at once, not one after another.
 *
 * A league's standings ask `knownRosterRows` for the roster rows of every unclaimed fighter, and
 * each Event costs its own reads. One after another, a league of twenty Events waited for twenty
 * round trips in a row. Here: both Events' Tournament reads go out before either Event's next read.
 */
import { describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables } from '../testing/supabase-chain';
import { THE_PUBLIC } from './competition-visibility';
import { knownRosterRows, visibleEventRows } from './hidden-entrants';

const event = (id: string) => ({
  id,
  status: 'published',
  organization_id: 'org-a',
  event_kind: 'standard',
});

function build() {
  const db = mockSupabase({
    events: { rows: [event('e-1'), event('e-2')] },
    // A draft Tournament in each: its entrants are hidden from the public, so each Event reads on.
    tournaments: {
      rows: [
        { id: 't-1', event_id: 'e-1', status: 'draft' },
        { id: 't-2', event_id: 'e-2', status: 'draft' },
      ],
    },
    registrations: { rows: [] },
    persons: { rows: [] },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
  });
  return { db, deps: { supabase: { service: db.service } } as never };
}

/** The tables read after the Events, in the order they were asked. */
const afterEvents = (db: ReturnType<typeof mockSupabase>) =>
  queriedTables(db.from).filter((table) => table !== 'events');

describe('the lists that span many Events', () => {
  it("knownRosterRows asks both Events' Tournaments before either Event's entries", async () => {
    const { db, deps } = build();
    const roster = [
      { id: 'p-1', eventId: 'e-1' },
      { id: 'p-2', eventId: 'e-2' },
    ];

    await knownRosterRows(deps, roster, THE_PUBLIC);

    expect(afterEvents(db).slice(0, 2)).toEqual(['tournaments', 'tournaments']);
  });

  it('visibleEventRows keeps the rows of each Event it may see, as before', async () => {
    const { deps } = build();
    const rows = [
      { eventId: 'e-1', tournamentId: 't-1' },
      { eventId: 'e-2', tournamentId: null },
      { eventId: 'e-unknown', tournamentId: null },
    ];

    await expect(visibleEventRows(deps, rows, THE_PUBLIC)).resolves.toEqual([
      { eventId: 'e-2', tournamentId: null },
    ]);
  });
});
