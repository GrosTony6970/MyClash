/**
 * The seeded tables the Live board's service tests share.
 *
 * Split out when `staff.service.live-board.test.ts` reached the 400-line cap.
 * Test-only: `apps/api/tsconfig.build.json` lists it by path, and
 * `scripts/check-test-code-leak.mjs` proves nothing in the emit imports it.
 *
 * Each table holds at least one decoy — another Event's Lice, another Lice's
 * bout, a voided bout — so a filter that stops narrowing changes an answer in
 * the tests rather than going quiet.
 */
import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase } from '../../common/testing/supabase-chain';

export const ORG = 'O1';
export const EVENT = 'E1';
export const OTHER_EVENT = 'E2';
export const LICE = 'L1';
export const OTHER_LICE = 'L2';
export const ACCOUNT = 'a1';

export const req = { cookies: {} } as never;

export const eventRow = (id: string) => ({
  id,
  // The decoy belongs to a DIFFERENT organisation. That is what makes the
  // event lookup load-bearing: read the wrong row and the board asks for a
  // role on the wrong organisation, which is the check standing in front of it.
  organization_id: id === EVENT ? ORG : 'O2',
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-07-21',
  end_date: '2099-12-31',
});

/** The board's bouts sit in these phases; the length helper reads their kind and Tournament. */
export const TOURNAMENT = 'a1a1a1a1-1111-4111-8111-111111111111';
export const POOL_PHASE = 'ph-pool';
export const SWISS_PHASE = 'ph-swiss';
export const SHEET = {
  poolMatchDurationMinutes: 6,
  swissMatchDurationMinutes: 7,
  eliminationMatchDurationMinutes: 8,
  finalsMatchDurationMinutes: 11,
};

/** An Event's planner sheet, as stored. A field left out reads as the default. */
export const sheetRow = (eventId: string, config: Record<string, unknown>) => ({
  event_id: eventId,
  config_json: config,
});

/** A bout on a Lice. `scoped` is the embed countBoutProgress filters through. */
export const matchRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  lice_id: LICE,
  status: 'scheduled',
  red_score: 0,
  blue_score: 0,
  match_number_label: `#${id}`,
  scheduled_at: '2026-07-21T10:00:00Z',
  started_at: null,
  ended_at: null,
  pool_id: null,
  phase_id: POOL_PHASE,
  planned_duration_override_minutes: null,
  bracket_slots: null,
  red: null,
  blue: null,
  'phases.tournaments.event_id': EVENT,
  ...over,
});

/**
 * `matches` is ONE seeded table serving all three reads — the live bouts, the
 * completed tail and both head-only counts. That is exactly the case a queue
 * cannot express, because it would have to predict the order they interleave.
 */
export const MATCH_ROWS = [
  matchRow('m1', { status: 'running', red_score: 1, started_at: '2026-07-21T10:01:00Z' }),
  matchRow('m0', {
    status: 'completed',
    red_score: 5,
    blue_score: 3,
    scheduled_at: '2026-07-21T09:00:00Z',
    started_at: '2026-07-21T09:00:00Z',
    ended_at: '2026-07-21T09:20:00Z',
  }),
  matchRow('m-void', { status: 'voided' }),
  matchRow('m-done-elsewhere', {
    lice_id: OTHER_LICE,
    status: 'completed',
    ended_at: '2026-07-21T09:30:00Z',
    'phases.tournaments.event_id': OTHER_EVENT,
  }),
  matchRow('m-elsewhere', {
    lice_id: OTHER_LICE,
    status: 'running',
    'phases.tournaments.event_id': OTHER_EVENT,
  }),
];

export const account = (id: string, eventId: string, name: string) => ({
  id,
  event_id: eventId,
  display_name: name,
  username: name.toLowerCase(),
  status: 'active',
});

/** The board's tables, each holding a decoy on the axis its query filters by. */
export function boardTables(over: Record<string, unknown> = {}) {
  return {
    events: { rows: [eventRow(OTHER_EVENT), eventRow(EVENT)] },
    lices: {
      rows: [
        { id: LICE, event_id: EVENT, name: 'Piste 1', sort_order: 0 },
        { id: OTHER_LICE, event_id: OTHER_EVENT, name: 'Piste 9', sort_order: 1 },
      ],
    },
    matches: { rows: MATCH_ROWS },
    event_staff_accounts: {
      rows: [account(ACCOUNT, EVENT, 'Marie'), account('a9', OTHER_EVENT, 'Jean')],
    },
    event_staff_lice_assignments: {
      rows: [
        { event_id: EVENT, staff_account_id: ACCOUNT, lice_id: LICE },
        { event_id: OTHER_EVENT, staff_account_id: 'a9', lice_id: OTHER_LICE },
      ],
    },
    event_programme_configs: { rows: [] },
    phases: {
      rows: [
        { id: POOL_PHASE, type: 'pool', tournament_id: TOURNAMENT },
        { id: SWISS_PHASE, type: 'swiss', tournament_id: TOURNAMENT },
      ],
    },
    referee_assignments: { rows: [] },
    ...over,
  };
}

export function build(tables: Record<string, unknown>, orgRole: 'allow' | 'refuse' = 'allow') {
  const supabase = mockSupabase(tables as never);
  const assertOrgRole = vi.fn(async () => {
    if (orgRole === 'refuse') throw new ForbiddenException('no role');
  });
  const svc = new StaffService(
    supabase as never,
    { assertOrgRole } as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(
    svc as never as { getSupabaseUserId: () => Promise<string> },
    'getSupabaseUserId',
  ).mockResolvedValue('U1');
  return { svc, supabase, assertOrgRole };
}
