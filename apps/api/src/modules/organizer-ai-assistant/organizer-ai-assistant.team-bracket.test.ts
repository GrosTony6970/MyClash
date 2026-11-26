import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { ORGANIZER_CHAT_TOOLS } from '../organizer-chat/organizer-chat.tools';
import { withStampedRules } from '../phases/match-rules.fixtures';
import { PhasesService } from '../phases/phases.service';
import { OrganizerAIAssistantService } from './organizer-ai-assistant.service';

/**
 * The organiser applies the assistant's bracket plan for Team Longsword, a team Tournament of
 * three teams: `generate_bracket` with no phase type. The assistant passes the action to the one
 * bracket door unchanged, with the organiser as its actor, and the door takes a single elimination
 * of teams (call 2 of slice 1c-1). The door is the real one here, over seeded tables: a double
 * that answered for it would prove nothing about the guard.
 */

const TEAM_T = 't-team';
const team = (id: string, seed: number, hour: string, tournamentId = TEAM_T) => ({
  id,
  seed,
  created_at: `2026-11-01T${hour}:00:00.000Z`,
  tournament_id: tournamentId,
});

/** The organiser's bracket plan: one `generate_bracket`, with no phase type unless one is named. */
const draft = (phaseType?: 'double_elim') => ({
  id: 'draft-1',
  event_id: 'event-1',
  actor_user_id: 'user-1',
  draft_type: 'bracket_plan',
  status: 'ready',
  proposed_actions_json: [
    { kind: 'generate_bracket', tournamentId: TEAM_T, ...(phaseType && { phaseType }) },
  ],
  events: { organization_id: 'org-1' },
});

const TEAM_TOURNAMENT = {
  id: TEAM_T,
  event_id: 'event-1',
  entrant_kind: 'team',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.1.0',
  events: { organization_id: 'org-1' },
};

/** Three teams of Team Longsword, and Team Rapier's next door: a count that drops the filter has four. */
const TEAMS = [
  team('team-other', 1, '06', 't-other'),
  team('team-a', 1, '07'),
  team('team-b', 2, '08'),
  team('team-c', 3, '09'),
];

function makeAssistant(phaseType?: 'double_elim') {
  const supabase = mockSupabase(
    ...withStampedRules({
      organizer_ai_assistant_drafts: { rows: [draft(phaseType)] },
      tournaments: { rows: [TEAM_TOURNAMENT] },
      phases: { rows: [], returning: { id: 'phase-new' } },
      bracket_slots: { rows: [], returning: (_row, i) => ({ id: `slot-${i}` }) },
      matches: { rows: [] },
      teams: { rows: TEAMS },
      audit_log: { rows: [] },
    }),
  );
  const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
  const phases = new PhasesService(
    supabase as never,
    { placeMatches: vi.fn(() => Promise.resolve()) } as never,
    undefined,
    orgs as never,
  );
  const assistant = new OrganizerAIAssistantService(
    supabase as never,
    {} as never,
    orgs as never,
    {} as never,
    phases,
    {} as never,
    {} as never,
  );
  return { assistant, supabase, orgs };
}

describe('the assistant generates a team bracket', () => {
  it('applies a single elimination of the three teams through the one bracket door', async () => {
    const { assistant, supabase, orgs } = makeAssistant();

    const applied = await assistant.applyDraft('event-1', 'draft-1', 'user-1');

    expect(applied).toMatchObject({ status: 'applied' });
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    const phase = writesTo(supabase, 'phases').find((write) => write.op === 'insert');
    expect(phase?.row).toMatchObject({ tournament_id: TEAM_T, type: 'single_elim' });
    expect((phase?.row as SupabaseRow)['config_json']).toMatchObject({ fighterCount: 3 });
    expect(selectsFor(supabase.from, 'tournaments')).toEqual([
      'id',
      'id, entrant_kind, events!inner(organization_id)',
    ]);
  });

  it('is refused a double elimination, and marks the draft failed with nothing written', async () => {
    const { assistant, supabase } = makeAssistant('double_elim');

    await expect(assistant.applyDraft('event-1', 'draft-1', 'user-1')).rejects.toMatchObject({
      response: { reason: 'team_tournament_not_supported' },
    });
    expect(writesTo(supabase, 'phases')).toEqual([]);
    expect(writesTo(supabase, 'organizer_ai_assistant_drafts')[0]?.row).toMatchObject({
      status: 'failed',
    });
  });
});

/**
 * The model is told before it proposes, as the pool plan tells it a team Tournament's spread: a
 * team Tournament takes a single elimination only. The door above still refuses the other.
 */
describe('the assistant tells the model a team bracket is a single elimination', () => {
  const caveat = /team tournament takes "?single_elim"? only, never "?double_elim"?/;

  it('in the bracket plan it asks for', () => {
    const contract = (
      OrganizerAIAssistantService as unknown as { ACTION_CONTRACT: Record<string, string> }
    ).ACTION_CONTRACT;
    expect(contract['bracket_plan']).toMatch(caveat);
  });

  it('in the chat tool generate_bracket', () => {
    const tool = ORGANIZER_CHAT_TOOLS.find((t) => t.name === 'generate_bracket');
    expect(tool?.description).toMatch(caveat);
  });
});
