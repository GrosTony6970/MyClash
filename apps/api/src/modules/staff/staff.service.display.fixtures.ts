// Seeded bouts and builders for the display payload tests, split out when
// staff.service.test.ts reached the 400-line cap. It imports the Supabase
// double (vitest), so it is named in tsconfig.build.json's exclude list.
//
// Two test files share it: staff.service.test.ts (the payload and the pad's
// prev/next tiles) and staff.service.display-next.test.ts (which NEXT bout a
// projector may be shown, rulings 82 and 89).

import { StaffService } from './staff.service';
import { mockSupabase, type SupabaseRow } from '../../common/testing/supabase-chain';

export const LICE = 'lice-1';
export const OTHER_LICE = 'lice-2';

/** Distinct instants, so `scheduled_at` decides an order instead of tying. */
export const at = (hour: number) => `2026-05-05T${String(hour).padStart(2, '0')}:00:00.000Z`;

/** The hall projector: no login, no staff cookie. */
export const ANON = { userId: 'anonymous', staff: null };

export function serviceOn(rows: readonly SupabaseRow[]) {
  const supabase = mockSupabase({ matches: { rows } });
  const service = new StaffService(supabase as never, {} as never, {} as never, {} as never);
  return { service, from: supabase.from };
}

/** One side of a bout, with the embeds the display payload reads. */
export function side(
  registrationId: string,
  given: string,
  extra: { club?: { name: string; logo_url: string | null }; photo?: string } = {},
) {
  return {
    id: registrationId,
    persons: {
      id: `p-${registrationId}`,
      given_name: given,
      family_name: 'X',
      club_id: extra.club ? 'club-lyon' : null,
      clubs: extra.club ?? null,
      global_persons: extra.photo ? { photo_url: extra.photo } : null,
    },
  };
}

/** A bout in the shape `mapDisplayMatch` unwraps. */
export function displayRow(id: string, overrides: SupabaseRow = {}): SupabaseRow {
  return {
    id,
    status: 'scheduled',
    red_score: 0,
    blue_score: 0,
    red_registration_id: 'reg-r',
    blue_registration_id: 'reg-b',
    match_number_label: '1',
    pool_id: null,
    lice_id: null,
    scheduled_at: null,
    lices: { id: LICE, name: 'Lice 1', events: null },
    pools: null,
    red: side('reg-r', 'A'),
    blue: side('reg-b', 'B'),
    phases: {
      tournaments: {
        id: 't-1',
        name: 'Longsword Open',
        weapon: 'longsword',
        status: 'running',
        scoring_config_json: null,
        ruleset_config: null,
      },
    },
    // The flat key a dotted filter reads on a seeded row (`onlyPublicTournaments`).
    'phases.tournaments.status': 'running',
    bracket_slots: null,
    ...overrides,
  };
}
