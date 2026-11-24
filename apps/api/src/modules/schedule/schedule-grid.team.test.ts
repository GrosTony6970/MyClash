import { describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { ScheduleGridService } from './schedule-grid.service';

// The lengths and the sheet make reads of their own; what they answer is not this file's concern.
vi.mock('./match-lengths', () => ({
  resolveMatchLengths: vi.fn((_db: unknown, _eventId: string, inputs: Array<{ id: string }>) =>
    Promise.resolve(new Map(inputs.map((input) => [input.id, 5]))),
  ),
}));
vi.mock('../programme/programme-sheet', () => ({
  readProgrammeSheet: vi.fn(() => Promise.resolve({ minRestMinutes: 10, tournaments: [] })),
}));

/**
 * The schedule grid of an Event with Team Longsword (Lyon Blades v Paris Fers) and a bracket
 * placeholder of Open Longsword whose sides are not known yet. Each card keys its sides by side
 * key: a team id for a team bout, null for a side not known (it was `''`, ADR-022).
 */
const bout = (id: string, phase: string, sides: Record<string, string | null>) => ({
  id,
  match_number_label: `${id}-label`,
  status: 'scheduled',
  lice_id: null,
  scheduled_at: null,
  phase_id: phase,
  pool_id: null,
  bracket_slot_id: null,
  swiss_round_id: null,
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: null,
  blue_team_id: null,
  planned_duration_override_minutes: null,
  ...sides,
});

describe('ScheduleGridService — the side keys of a card', () => {
  it('keys a team bout by its teams and a side not known by null', async () => {
    const db = mockSupabase({
      events: {
        rows: [{ id: 'e1', status: 'published', organization_id: 'club', event_kind: 'standard' }],
      },
      tournaments: {
        rows: [
          {
            id: 't-team',
            event_id: 'e1',
            name: 'Team Longsword',
            slug: 'team',
            status: 'published',
          },
          { id: 't-open', event_id: 'e1', name: 'Open', slug: 'open', status: 'published' },
        ],
      },
      phases: {
        rows: [
          { id: 'ph-team', type: 'pool', tournament_id: 't-team', config_json: null },
          { id: 'ph-open', type: 'single_elim', tournament_id: 't-open', config_json: null },
        ],
      },
      matches: {
        rows: [
          bout('m-team', 'ph-team', { red_team_id: 'team-lyon', blue_team_id: 'team-paris' }),
          bout('m-placeholder', 'ph-open', {}),
        ],
      },
      vw_tournament_query_matches: {
        rows: [{ match_id: 'm-team', red_name: 'Lyon Blades', blue_name: 'Paris Fers' }],
      },
    });
    const service = new ScheduleGridService(db as never, {} as never);

    const rows = await service.listEventSchedule('e1', {
      userId: ANONYMOUS_USER_ID,
      staff: null,
    });

    expect(rows.map((r) => [r.id, r.redSideId, r.blueSideId, r.redFighterName])).toEqual([
      ['m-placeholder', null, null, null],
      ['m-team', 'team-lyon', 'team-paris', 'Lyon Blades'],
    ]);
    expect(selectsFor(db.from, 'matches')).toEqual([
      'id, match_number_label, status, lice_id, scheduled_at, started_at, ended_at, phase_id, pool_id, bracket_slot_id, swiss_round_id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, planned_duration_override_minutes',
    ]);
  });
});
