import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { ORGANIZER_CHAT_TOOLS } from '../organizer-chat/organizer-chat.tools';
import { OrganizerAIAssistantService } from './organizer-ai-assistant.service';

/**
 * The organiser applies the assistant's pool plan. A team Tournament takes a spread (call 11 of
 * slice 1c-1): `seed` sends no draw seed, `random` sends the model's, and neither sends a club or
 * rating rule. The arguments reaching the Pool door are asserted themselves: the door is doubled.
 */

const T = 't-1';

const draft = (action: Record<string, unknown>) => ({
  id: 'draft-1',
  event_id: 'event-1',
  actor_user_id: 'user-1',
  draft_type: 'pool_plan',
  status: 'ready',
  proposed_actions_json: [{ kind: 'generate_pools', tournamentId: T, targetSize: 4, ...action }],
  events: { organization_id: 'org-1' },
});

async function apply(entrantKind: 'team' | 'individual', action: Record<string, unknown>) {
  const supabase = mockSupabase({
    organizer_ai_assistant_drafts: { rows: [draft(action)] },
    tournaments: { rows: [{ id: T, event_id: 'event-1', entrant_kind: entrantKind }] },
    audit_log: { rows: [] },
  });
  const generatePools = vi.fn().mockResolvedValue({ poolCount: 2 });
  const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
  const assistant = new OrganizerAIAssistantService(
    supabase as never,
    {} as never,
    orgs as never,
    {} as never,
    { generatePools } as never,
    {} as never,
    {} as never,
  );
  await assistant.applyDraft('event-1', 'draft-1', 'user-1');
  return { generatePools, supabase };
}

const modelAction = {
  enforceSchoolSeparation: true,
  enforceSkillBalance: true,
  seed: 42,
};

describe('the assistant generates Pools for a team Tournament', () => {
  it('sends the seed spread with no draw seed and no club or rating rule', async () => {
    const { generatePools, supabase } = await apply('team', { ...modelAction, teamSpread: 'seed' });

    const dto = generatePools.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(dto).toEqual({ targetSize: 4, teamSpread: 'seed', discardScoredResults: 0 });
    expect('seed' in dto).toBe(false);
    expect('enforceSchoolSeparation' in dto).toBe(false);
    expect('enforceSkillBalance' in dto).toBe(false);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id', 'id, entrant_kind']);
    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([
      ['id', [T]],
      ['id', [T]],
    ]);
  });

  it("sends the random spread with the model's draw seed", async () => {
    const { generatePools } = await apply('team', { ...modelAction, teamSpread: 'random' });

    expect(generatePools.mock.calls[0]?.[1]).toEqual({
      targetSize: 4,
      teamSpread: 'random',
      seed: 42,
      discardScoredResults: 0,
    });
  });

  it('sends no spread the model did not name, for the door to refuse by name', async () => {
    const { generatePools } = await apply('team', { ...modelAction, teamSpread: 'best' });

    expect(generatePools.mock.calls[0]?.[1]).toEqual({ targetSize: 4, discardScoredResults: 0 });
  });
});

describe('the assistant generates Pools for an individual Tournament', () => {
  it('is unchanged: the club and rating rules and the seed, and no spread', async () => {
    const { generatePools } = await apply('individual', { ...modelAction, teamSpread: 'seed' });

    expect(generatePools.mock.calls[0]?.[1]).toEqual({
      targetSize: 4,
      enforceSchoolSeparation: true,
      enforceSkillBalance: true,
      seed: 42,
      discardScoredResults: 0,
    });
  });
});

describe('the chat tool generate_pools', () => {
  it('offers the team spread, as seed or random', () => {
    const tool = ORGANIZER_CHAT_TOOLS.find((t) => t.name === 'generate_pools');
    const properties = (tool?.parameters as { properties: Record<string, unknown> }).properties;
    expect(properties['teamSpread']).toEqual({ type: 'string', enum: ['seed', 'random'] });
  });
});
