/**
 * The seeded database and the doubles the protest tests share: the service test and the team
 * test. Test-only; it is excluded from the build.
 */
import { mockSupabase, type TableSeed } from '../../common/testing/supabase-chain';
import type { ScoringActor } from '../staff/staff.service';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { OrganizationsService } from '../organizations/organizations.service';
import { ProtestsService } from './protests.service';

export const SCOREKEEPER = 'a0000000-0000-4000-8000-000000000001';
export const SUPER_ADMIN = 'a0000000-0000-4000-8000-000000000002';
export const STRANGER = 'a0000000-0000-4000-8000-000000000003';
export const RED = 'c0000000-0000-4000-8000-00000000000a';
export const BLUE = 'c0000000-0000-4000-8000-00000000000b';
export const THIRD = 'c0000000-0000-4000-8000-00000000000c';
export const TEAM_RED = 'd0000000-0000-4000-8000-00000000000a';
export const TEAM_BLUE = 'd0000000-0000-4000-8000-00000000000b';
export const TEAM_OTHER = 'd0000000-0000-4000-8000-00000000000c';

export interface Setup {
  status?: string;
  lockedAt?: string | null;
  eventStatus?: string;
  awaitingRoundAdvance?: boolean;
  protests?: TableSeed;
  matchEvents?: Record<string, unknown>[];
}

export function bout(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: 'running',
    red_registration_id: RED,
    blue_registration_id: BLUE,
    phase_id: 'phase-1',
    locked_at: null,
    current_round: 2,
    awaiting_round_advance: false,
    phases: {
      tournament_id: 'tournament-1',
      tournaments: { events: { organization_id: 'org-1' } },
    },
    ...over,
  };
}

export function setup(s: Setup = {}) {
  const db = mockSupabase({
    matches: {
      rows: [
        bout('m1', {
          status: s.status ?? 'running',
          locked_at: s.lockedAt ?? null,
          awaiting_round_advance: s.awaitingRoundAdvance ?? false,
        }),
        bout('m2'),
        // A team bout: its Registration columns are null, its sides are the teams.
        bout('m-team', {
          red_registration_id: null,
          blue_registration_id: null,
          red_team_id: TEAM_RED,
          blue_team_id: TEAM_BLUE,
        }),
        // A team bout waiting for its second team.
        bout('m-team-wait', {
          red_registration_id: null,
          blue_registration_id: null,
          red_team_id: TEAM_RED,
          blue_team_id: null,
        }),
      ],
    },
    match_protests: s.protests ?? {
      rows: [],
      returning: { id: 'protest-new', recorded_at: '2026-11-17T10:00:01Z' },
    },
    match_events: { rows: s.matchEvents ?? [] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1' }] },
    events: {
      rows: [{ id: 'event-1', organization_id: 'org-1', status: s.eventStatus ?? 'running' }],
    },
    platform_roles: { rows: [{ user_id: SUPER_ADMIN, role: 'super_admin' }] },
    organization_members: {
      rows: [{ organization_id: 'org-1', user_id: SCOREKEEPER, role: 'scorekeeper' }],
    },
  });
  const service = new ProtestsService(
    db as never,
    new FrozenResultsGuard(db as never, {} as never),
    new OrganizationsService(db as never),
  );
  return { db, service };
}

export const PAD: ScoringActor = { staffAccountId: 'staff-1' };

export const dto = (over: Record<string, unknown> = {}) => ({
  clientUuid: 'p-uuid-1',
  sequence: 7,
  registrationId: RED,
  occurredAt: '2026-11-17T10:00:00Z',
  ...over,
});
