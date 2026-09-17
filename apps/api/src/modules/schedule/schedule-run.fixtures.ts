import { vi } from 'vitest';
import { mockSupabase, type TableSeed } from '../../common/testing/supabase-chain';
import { PROGRAMME_CONFIG_DEFAULTS } from '../programme/dto/programme.dto';
import { ScheduleRunService } from './schedule-run.service';

/**
 * The run window save's seeded tables, for `schedule-run.service.test.ts`. Split
 * out when that file reached the 400-line cap, the shape
 * `matches/match-placement.fixtures.ts` already sets. It imports vitest, so
 * `tsconfig.build.json` excludes it by path.
 */

export const EVENT = 'event-1';
export const TOURNAMENT = '11111111-1111-4111-8111-111111111111';
export const POOL = 'pool-a';
export const DAY = '2026-06-06';

export const iso = (hhmmss: string) => `${DAY}T${hhmmss}.000Z`;

export const MEMBERSHIP_SELECT = 'id, phases!inner(tournaments!inner(event_id))';
// The stored length is deliberately absent: a run save either types one length
// for every bout or hands them all back to the sheet, so no row's own counts.
export const RUN_SELECT =
  'id, phase_id, pool_id, lice_id, scheduled_at, phases!inner(tournament_id)';

export function row(
  id: string,
  liceId: string | null,
  start: string | null,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    phase_id: 'phase-pool',
    // A row missing a column the code reads makes it `undefined`, and a
    // `!== null` test then passes on a fixture that means the opposite.
    pool_id: null,
    lice_id: liceId,
    scheduled_at: start === null ? null : iso(start),
    planned_duration_override_minutes: null,
    // Serves both reads: the membership check embeds the Event through the
    // Tournament, the run read embeds the Tournament for its rest.
    phases: { tournament_id: TOURNAMENT, tournaments: { event_id: EVENT } },
    ...over,
  };
}

export function tables(
  rows: Array<ReturnType<typeof row>>,
  sheet: Record<string, unknown> = {},
): Record<string, TableSeed> {
  return {
    events: { rows: [{ id: EVENT, organization_id: 'org-1' }] },
    matches: { rows },
    event_programme_configs: {
      rows: [{ event_id: EVENT, config_json: { ...PROGRAMME_CONFIG_DEFAULTS, ...sheet } }],
    },
    phases: {
      rows: [
        { id: 'phase-pool', type: 'pool', tournament_id: TOURNAMENT },
        { id: 'phase-swiss', type: 'swiss', tournament_id: TOURNAMENT },
      ],
    },
  };
}

export const orgs = { assertOrgRole: vi.fn() };
export const placement = { placeMatches: vi.fn() };

export function makeService(seeded: Record<string, TableSeed>) {
  const supabase = mockSupabase(seeded);
  const service = new ScheduleRunService(supabase as never, orgs as never, placement as never);
  return { service, supabase };
}

/** The batch handed to the placement owner. */
export const placed = () =>
  placement.placeMatches.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
