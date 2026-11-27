import { beforeEach, describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { mockSupabaseFrom, resetHarness, service } from './organizer-ai-assistant.harness';

/**
 * The assistant's referee drafts carry the rule-8 notice (CLAUDE.md rule 8; ADR-016, 2026-11-13;
 * design decision 11). A team's slots have no names in slice 1b-1, so the one checker cannot see
 * a team's Fighters. A draft that assigns a referee to a team Pool, or to a bout of a team
 * Tournament, carries `uncheckedFighters`, the flag the referee board uses. It refuses nothing.
 *
 * The model writes the ids and the read runs with the service role, so it is scoped to the
 * drafts' Event: a team Pool or bout of another Event finds no row and gives no flag. The seeded
 * rows carry the embedded filter's column under its dotted name, so the `.eq` narrows them.
 */

const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const TEAM_POOL = '11111111-1111-4111-8111-111111111111';
const SOLO_POOL = '22222222-2222-4222-8222-222222222222';
const TEAM_BOUT = '33333333-3333-4333-8333-333333333333';
const SOLO_BOUT = '44444444-4444-4444-8444-444444444444';
const FOREIGN_POOL = '55555555-5555-4555-8555-555555555555';
const FOREIGN_BOUT = '66666666-6666-4666-8666-666666666666';
const KIND_READ = 'id, phases!inner(tournaments!inner(event_id, entrant_kind))';
const EVENT_FILTER = 'phases.tournaments.event_id';

const ofKind = (id: string, entrant_kind: unknown, event_id = EVENT) => ({
  id,
  phases: { tournaments: { event_id, entrant_kind } },
  [EVENT_FILTER]: event_id,
});

const refereeDraft = (id: string, target: Record<string, unknown>) => ({
  id,
  event_id: EVENT,
  draft_type: 'referee_assignments',
  status: 'ready',
  created_at: '2026-11-25T10:00:00Z',
  proposed_actions_json: [{ kind: 'assign_referee', userId: 'p-1', role: 'referee', ...target }],
  events: { organization_id: 'org-1' },
});

const DRAFTS = [
  refereeDraft('d-team-pool', { poolId: TEAM_POOL }),
  refereeDraft('d-solo-pool', { poolId: SOLO_POOL }),
  refereeDraft('d-team-bout', { matchId: TEAM_BOUT }),
  refereeDraft('d-solo-bout', { matchId: SOLO_BOUT }),
  // An id the model made up, of no row id's shape: no read carries it, no notice.
  refereeDraft('d-made-up', { poolId: 'pool-a' }),
  // Another Event's team Pool and team bout: the scoped read finds neither.
  refereeDraft('d-foreign-pool', { poolId: FOREIGN_POOL }),
  refereeDraft('d-foreign-bout', { matchId: FOREIGN_BOUT }),
];

const POOLS = [
  ofKind(TEAM_POOL, 'team'),
  ofKind(SOLO_POOL, 'individual'),
  ofKind(FOREIGN_POOL, 'team', OTHER_EVENT),
];
const MATCHES = [
  ofKind(TEAM_BOUT, 'team'),
  ofKind(SOLO_BOUT, 'individual'),
  ofKind(FOREIGN_BOUT, 'team', OTHER_EVENT),
];

function seeded(pools = POOLS) {
  const supabase = mockSupabase({
    events: { rows: [{ id: EVENT, organization_id: 'org-1', name: 'Spring Open' }] },
    organizer_ai_assistant_drafts: { rows: DRAFTS },
    pools: { rows: pools },
    matches: { rows: MATCHES },
  });
  mockSupabaseFrom.mockImplementation((table: string) => supabase.from(table));
  return supabase;
}

const flagOf = (drafts: Array<Record<string, unknown>>, id: string) =>
  drafts.find((draft) => draft['id'] === id);

describe('the referee drafts of the AI assistant', () => {
  beforeEach(() => resetHarness());

  it('marks a draft of a team Pool or a team bout of the Event, and no other', async () => {
    const supabase = seeded();

    const drafts = (await service().listDrafts(EVENT, 'user-1')) as Array<Record<string, unknown>>;

    expect(flagOf(drafts, 'd-team-pool')?.['uncheckedFighters']).toBe(true);
    expect(flagOf(drafts, 'd-team-bout')?.['uncheckedFighters']).toBe(true);
    for (const id of ['d-solo-pool', 'd-solo-bout', 'd-made-up']) {
      expect(flagOf(drafts, id)).not.toHaveProperty('uncheckedFighters');
    }
    // The kind is read through the Phase's Tournament, once per table for the whole list.
    expect(selectsFor(supabase.from, 'pools')).toEqual([KIND_READ]);
    expect(selectsFor(supabase.from, 'matches')).toEqual([KIND_READ]);
    expect(filtersFor(supabase.from, 'pools', 'in')).toEqual([
      ['id', [TEAM_POOL, SOLO_POOL, FOREIGN_POOL]],
    ]);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([
      ['id', [TEAM_BOUT, SOLO_BOUT, FOREIGN_BOUT]],
    ]);
  });

  it("gives no flag to a draft that names another Event's team Pool or bout", async () => {
    const supabase = seeded();

    const drafts = (await service().listDrafts(EVENT, 'user-1')) as Array<Record<string, unknown>>;

    expect(flagOf(drafts, 'd-foreign-pool')).not.toHaveProperty('uncheckedFighters');
    expect(flagOf(drafts, 'd-foreign-bout')).not.toHaveProperty('uncheckedFighters');
    expect(filtersFor(supabase.from, 'pools', 'eq')).toEqual([[EVENT_FILTER, EVENT]]);
    expect(filtersFor(supabase.from, 'matches', 'eq')).toEqual([[EVENT_FILTER, EVENT]]);
  });

  it('marks the one draft a screen opens', async () => {
    seeded();

    const draft = await service().getDraft(EVENT, 'd-team-pool', 'user-1');

    expect(draft).toHaveProperty('uncheckedFighters', true);
  });

  it('refuses to read a Pool whose kind the read left out as an individual one', async () => {
    seeded([ofKind(TEAM_POOL, undefined)]);

    await expect(service().listDrafts(EVENT, 'user-1')).rejects.toThrow(
      "The Tournament's kind was not read",
    );
  });
});
