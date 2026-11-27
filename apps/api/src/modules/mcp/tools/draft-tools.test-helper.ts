import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { mockSupabase, type SupabaseRow } from '../../../common/testing/supabase-chain';
import type { McpCaller } from '../mcp-server';

// The harness of the draft tools' tests: the shared Supabase double over one Event (FAL 2026,
// club `salle-lyon`) and its Tournament (Longsword Open) with its bouts and pistes, uuid ids in
// every row, plus a decoy of each table in another Event. `createDraftFromAction` is a double:
// the tools' own work is what they ask before it and what they answer from it.

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const EVENT = id(1);
export const ORG = id(2);
export const TOURNAMENT = id(3);
export const OTHER_EVENT = id(4);
export const DRAFT = id(5);
/** The Tournament's Pool phase, and its two bouts `LSW-P2-M04` and `LSW-P2-M05`. */
export const PHASE = id(6);
export const M04 = id(50);
export const M05 = id(51);
/** The Event's pistes `Piste 2`, `Piste 3` and `Arène`. */
export const PISTE_2 = id(40);
export const PISTE_3 = id(41);
export const ARENE = id(42);
export const caller: McpCaller = { userId: id(90), email: 'marie@example.org', clientId: id(91) };

/** Where the draft opens: the assistant page of the Event, on this draft (call W). */
export const LINK = `https://admin.myclash.fr/org/salle-lyon/events/${EVENT}/ai-assistant?draft=${DRAFT}`;

export const world = {
  readOnly: false,
  eventStatus: 'published',
  timezone: 'Europe/Paris',
  phases: [] as SupabaseRow[],
  decoys: [] as SupabaseRow[],
  matches: [] as SupabaseRow[],
  lices: [] as SupabaseRow[],
};

const eventRow = (over: SupabaseRow): SupabaseRow => ({
  name: 'FAL 2026',
  start_date: '2026-03-14',
  end_date: '2026-03-15',
  timezone: 'Europe/Paris',
  city: 'Lyon',
  country: 'FR',
  event_kind: 'real',
  ...over,
});

const tournamentRow = (over: SupabaseRow): SupabaseRow => ({
  name: 'Longsword Open',
  status: 'published',
  events: { id: EVENT, status: 'published', organization_id: ORG, event_kind: 'real' },
  ...over,
});

/** Ours, and another Event's Tournament `sabre-open`, each with its phases. */
const TOURNAMENTS: SupabaseRow[] = [
  tournamentRow({
    id: id(21),
    event_id: OTHER_EVENT,
    slug: 'sabre-open',
    name: 'Sabre Open',
    phases: [{ id: id(20) }],
  }),
  tournamentRow({
    id: TOURNAMENT,
    event_id: EVENT,
    slug: 'longsword-open',
    phases: [{ id: PHASE }],
  }),
];

/**
 * The Pools' decoys: another Tournament's Pools, and this one's bracket. The bracket tests
 * set their own in `world.decoys`.
 */
export const DECOY_PHASES: SupabaseRow[] = [
  { id: id(20), tournament_id: id(21), type: 'pool' },
  { id: id(22), tournament_id: TOURNAMENT, type: 'single_elim' },
];

/** A bout as the matches select reads it: Pool 2 of a longsword Tournament. */
export function bout(over: SupabaseRow): SupabaseRow {
  return {
    phase_id: PHASE,
    scheduled_at: null,
    pool_id: id(7),
    lice_id: null,
    lices: null,
    phases: { config_json: {}, tournaments: { weapon: 'longsword' } },
    pools: { sort_order: 1 },
    bracket_slots: null,
    swiss_rounds: null,
    ...over,
  };
}

/** The bouts: ours, and another Tournament's with the same code. */
const BOUTS: SupabaseRow[] = [
  bout({ id: M04, match_number_label: 'M04' }),
  bout({ id: M05, match_number_label: 'M05' }),
  bout({ id: id(52), phase_id: id(20), match_number_label: 'M04' }),
];

/** The pistes: the Event's, and another Event's with one of the same names. */
const LICES: SupabaseRow[] = [
  { id: PISTE_2, event_id: EVENT, name: 'Piste 2' },
  { id: PISTE_3, event_id: EVENT, name: 'Piste 3' },
  { id: ARENE, event_id: EVENT, name: 'Arène' },
  { id: id(43), event_id: OTHER_EVENT, name: 'Piste 2' },
];

export const assertOrgRole = vi.fn();
export const createDraftFromAction = vi.fn();
export const usableRulesetVersion = vi.fn();
export const getClient = vi.fn();

/** The draft `createDraftFromAction` answers: every field of the API's draft, ids included. */
export function savedDraft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DRAFT,
    eventId: EVENT,
    tournamentId: TOURNAMENT,
    draftType: 'pool_plan',
    prompt: 'Claude proposed: generate_pools',
    summary: null,
    proposedActions: [{ kind: 'generate_pools', tournamentId: TOURNAMENT, poolCount: 4 }],
    validationState: { ok: true, warnings: [], errors: [] },
    status: 'ready',
    applyStarted: false,
    error: null,
    readable: [{ kind: 'generate_pools', tournament: { name: 'Longsword Open' }, poolCount: 4 }],
    ...over,
  };
}

export function resetWorld(): void {
  Object.assign(world, {
    readOnly: false,
    eventStatus: 'published',
    timezone: 'Europe/Paris',
    phases: [],
    decoys: DECOY_PHASES,
    matches: [...BOUTS],
    lices: [...LICES],
  });
  assertOrgRole.mockReset().mockResolvedValue('admin');
  createDraftFromAction.mockReset().mockResolvedValue(savedDraft());
  usableRulesetVersion.mockReset().mockResolvedValue('1.1.0');
  getClient.mockReset().mockResolvedValue({ data: { client_name: 'Claude' }, error: null });
}

export const forbidden = () => new ForbiddenException('Requires admin role or higher');

/** The double over `world`, and the deps a draft tool takes. */
export function harness(domain: string | null = 'myclash.fr') {
  const supabase = mockSupabase({
    feature_flags: { rows: [{ key: 'read_only_mode', enabled: world.readOnly }] },
    events: {
      rows: [
        eventRow({
          id: OTHER_EVENT,
          slug: 'other-2026',
          status: 'published',
          organization_id: id(9),
          organizations: { slug: 'other-club' },
        }),
        eventRow({
          id: EVENT,
          slug: 'fal-2026',
          status: world.eventStatus,
          timezone: world.timezone,
          organization_id: ORG,
          organizations: { slug: 'salle-lyon' },
        }),
      ],
    },
    tournaments: { rows: TOURNAMENTS },
    phases: { rows: [...world.decoys, ...world.phases] },
    matches: { rows: world.matches },
    lices: { rows: world.lices },
    weapon_catalog: {
      rows: [
        { name: 'Longsword', active: true },
        { name: 'Sabre', active: false },
      ],
    },
  });
  const deps = {
    supabase: { service: { ...supabase.service, auth: { admin: { oauth: { getClient } } } } },
    orgs: { assertOrgRole },
    assistant: { createDraftFromAction },
    events: { usableRulesetVersion },
    domain,
  } as never;
  return { supabase, deps };
}

/** An answer without its link: what the no-raw-ids check reads (the link holds ids by design). */
export function withoutLink(answer: unknown): unknown {
  const { link: _link, ...rest } = answer as Record<string, unknown>;
  return rest;
}
