import { vi } from 'vitest';
import { mockSupabase, type TableSeed } from '../../common/testing/supabase-chain';
import { PROGRAMME_CONFIG_DEFAULTS } from '../programme/dto/programme.dto';
import { MatchPlacementService } from './match-placement.service';

/**
 * The placement owner's seeded tables, shared by `match-placement.service.test.ts`
 * and `match-placement.override.test.ts`. Split out when the first reached the
 * 400-line cap. It imports vitest, so `tsconfig.build.json` excludes it by path.
 */

export const EVENT = 'event-1';
export const TOURNAMENT = '11111111-1111-4111-8111-111111111111';
export const LICE = 'lice-1';

export const at = (hhmm: string) => `2026-05-21T${hhmm}:00.000Z`;

/** The Event's sheet, defaults unless a case says otherwise. */
export function sheet(over: Record<string, unknown> = {}) {
  return { rows: [{ event_id: EVENT, config_json: { ...PROGRAMME_CONFIG_DEFAULTS, ...over } }] };
}

export function poolMatch(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    phase_id: 'phase-pool',
    lice_id: null,
    scheduled_at: null,
    status: 'scheduled',
    planned_duration_override_minutes: null,
    ...over,
  };
}

export function seed(over: Record<string, TableSeed> = {}): Record<string, TableSeed> {
  return {
    event_programme_configs: sheet(),
    phases: { rows: [{ id: 'phase-pool', type: 'pool', tournament_id: TOURNAMENT }] },
    lices: {
      rows: [
        { id: LICE, event_id: EVENT },
        { id: 'lice-elsewhere', event_id: 'event-2' },
      ],
    },
    matches: { rows: [poolMatch('m-1')] },
    ...over,
  };
}

export const alerts = { refresh: vi.fn().mockResolvedValue(undefined) };

export function makeService(tables: Record<string, TableSeed>) {
  const supabase = mockSupabase(tables);
  return { service: new MatchPlacementService(supabase as never, alerts as never), supabase };
}
