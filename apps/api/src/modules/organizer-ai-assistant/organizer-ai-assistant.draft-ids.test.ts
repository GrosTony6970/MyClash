import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  writesTo,
} from '../../common/testing/supabase-chain';
import {
  mockSupabaseFrom,
  placement,
  resetHarness,
  service,
} from './organizer-ai-assistant.harness';

/**
 * A draft's ids are uuids, lower-cased. Marie tells the chat "put LSW-P2-M04 on Piste 2 at
 * 14:30", and the model sends `"matchId": "LSW-P2-M04"`. That draft was `ready`; Confirm sent the
 * round code to a uuid column, and Postgres's 22P02 sentence reached the screen. Now the draft is
 * `failed` with a plain sentence, and the code is never sent to the database.
 */

const EVENT = 'event-1';
const DRAFTS = 'organizer_ai_assistant_drafts';
const MATCH = 'a0000000-0000-4000-8000-0000000000aa';
const LICE = 'b0000000-0000-4000-8000-0000000000bb';
const TOURNAMENT = 'c0000000-0000-4000-8000-0000000000cc';
const AT = '2026-12-05T13:30:00.000Z';

function seeded(drafts: Array<Record<string, unknown>> = []) {
  const supabase = mockSupabase({
    events: {
      rows: [{ id: EVENT, organization_id: 'org-1', name: 'Spring Open', timezone: null }],
    },
    tournaments: { rows: [{ id: TOURNAMENT, event_id: EVENT, name: 'Longsword Open' }] },
    [DRAFTS]: { rows: drafts, returning: { id: 'draft-1' } },
    audit_log: { data: null, error: null },
    matches: { rows: [{ id: MATCH, phases: { tournaments: { event_id: EVENT } } }] },
    lices: { rows: [{ id: LICE, event_id: EVENT, name: 'Piste 2' }] },
  });
  mockSupabaseFrom.mockImplementation((table: string) => supabase.from(table));
  return supabase;
}

const savedRow = (supabase: ReturnType<typeof seeded>) =>
  writesTo(supabase, DRAFTS)[0]?.row as Record<string, unknown>;

/** Every value any `.in` filter of any table was sent. */
const sentToIn = (supabase: ReturnType<typeof seeded>, tables: string[]) =>
  tables.flatMap((table) => filtersFor(supabase.from, table, 'in').flatMap(([, ids]) => ids));

describe('a draft holding an id that is not a uuid', () => {
  beforeEach(resetHarness);

  it('saves a round code as matchId failed, in a sentence with no id, and never reads it', async () => {
    const supabase = seeded();
    const action = { kind: 'schedule_match', matchId: 'LSW-P2-M04', liceId: LICE, scheduledAt: AT };

    await service().createDraftFromAction(EVENT, 'user-1', [action], { source: 'chat' });

    const row = savedRow(supabase);
    expect(row['status']).toBe('failed');
    expect(row['error']).toBe('matchId must be an id, not a name or a code');
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([]);
    expect(sentToIn(supabase, ['lices', 'tournaments'])).not.toContain('LSW-P2-M04');
  });

  it('saves a name as tournamentId failed, and never reads it, from the action or the caller', async () => {
    const supabase = seeded();
    const action = { kind: 'generate_pools', tournamentId: 'Longsword Open', poolCount: 4 };

    await service().createDraftFromAction(EVENT, 'user-1', [action], {
      source: 'chat',
      tournamentId: 'Longsword Open',
    });

    const row = savedRow(supabase);
    expect(row['status']).toBe('failed');
    expect(row['error']).toBe('tournamentId must be an id, not a name or a code');
    expect(row['tournament_id']).toBeNull();
    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([]);
  });

  it('stores an upper-case uuid lower-cased, in the action and the draft', async () => {
    const supabase = seeded();
    const action = { kind: 'generate_pools', tournamentId: TOURNAMENT.toUpperCase(), poolCount: 4 };

    await service().createDraftFromAction(EVENT, 'user-1', [action], {
      source: 'chat',
      tournamentId: TOURNAMENT.toUpperCase(),
    });

    const row = savedRow(supabase);
    expect(row['status']).toBe('ready');
    expect(row['tournament_id']).toBe(TOURNAMENT);
    expect(row['proposed_actions_json']).toEqual([
      { kind: 'generate_pools', tournamentId: TOURNAMENT, poolCount: 4 },
    ]);
  });
});

describe('Apply of a draft saved before the id check', () => {
  beforeEach(resetHarness);

  const oldDraft = (actions: Array<Record<string, unknown>>) => ({
    id: 'draft-1',
    event_id: EVENT,
    draft_type: 'schedule_grid',
    status: 'ready',
    proposed_actions_json: actions,
    updated_at: '2026-11-27T09:00:00.000Z',
    events: { organization_id: 'org-1' },
  });

  it('refuses a round code before any read with it, and claims nothing', async () => {
    const supabase = seeded([
      oldDraft([{ kind: 'schedule_match', matchId: 'LSW-P2-M04', liceId: LICE, scheduledAt: AT }]),
    ]);

    const refusal = await service()
      .applyDraft(EVENT, 'draft-1', 'user-1')
      .catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(BadRequestException);
    expect((refusal as Error).message).toBe('matchId must be an id, not a name or a code');
    expect(queriedTables(supabase.from)).toEqual([DRAFTS]);
    expect(supabase.writes).toEqual([]);
    expect(placement.placeMatches).not.toHaveBeenCalled();
  });

  it('checks and places an upper-case uuid lower-cased', async () => {
    const supabase = seeded([
      oldDraft([
        {
          kind: 'schedule_match',
          matchId: MATCH.toUpperCase(),
          liceId: LICE.toUpperCase(),
          scheduledAt: AT,
        },
      ]),
    ]);

    await service().applyDraft(EVENT, 'draft-1', 'user-1');

    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['id', [MATCH]]]);
    expect(placement.placeMatches).toHaveBeenLastCalledWith(EVENT, [
      { matchId: MATCH, liceId: LICE, scheduledAt: AT },
    ]);
  });
});
