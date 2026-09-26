/**
 * The assignment report finds a person's referee duties in THIS Event.
 *
 * A duty carries the global person (0063); the report is asked about the Event's
 * `persons.id`. It read duties by that id, so it found none: the delete dialog listed no
 * duty, a force-delete left every duty behind, and W1.2's lock check on it could never
 * fire. It had no Event filter either, so reading by the global id alone would reach the
 * same person's duties in other Events.
 */
import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { AssignmentsService } from './assignments.service';

const embed = {
  pools: { phases: { tournament_id: 't-1', tournaments: { id: 't-1', name: 'LS' } } },
};
const duty = (id: string, over: Record<string, unknown>) => ({
  id,
  scope_type: 'pool',
  pool_id: 'pool-1',
  match_id: null,
  role: 'arbitre_declarant',
  matches: null,
  ...embed,
  ...over,
});

function makeService(globalPersonId: string | null) {
  const supabase = mockSupabase({
    registrations: { data: [], error: null },
    matches: { data: [], error: null },
    persons: { rows: [{ id: 'person-1', global_person_id: globalPersonId }] },
    referee_assignments: {
      rows: [
        duty('here', { event_id: 'event-1', person_id: 'gp-1' }),
        duty('other-event', { event_id: 'event-2', person_id: 'gp-1' }),
        duty('keyed-by-event-person', { event_id: 'event-1', person_id: 'person-1' }),
      ],
    },
  });
  return { service: new AssignmentsService(supabase as never), supabase };
}

describe("the assignment report's referee duties", () => {
  it("reads the Event's duties of the person's global identity, and no other", async () => {
    const { service, supabase } = makeService('gp-1');

    const report = await service.getEventAssignments('event-1', 'person-1');

    expect(report.refereeAssignments.map((a) => a.assignmentId)).toEqual(['here']);
    expect(selectsFor(supabase.from, 'persons')).toEqual(['global_person_id']);
    expect(filtersFor(supabase.from, 'referee_assignments', 'eq')).toEqual([
      ['event_id', 'event-1'],
      ['person_id', 'gp-1'],
    ]);
  });

  it('a person with no global identity holds no duty, and nothing is asked', async () => {
    const { service, supabase } = makeService(null);

    const report = await service.getEventAssignments('event-1', 'person-1');

    expect(report.refereeAssignments).toEqual([]);
    expect(selectsFor(supabase.from, 'referee_assignments')).toEqual([]);
  });
});
