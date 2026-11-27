import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { mockSupabase, type SupabaseRow } from '../../../common/testing/supabase-chain';
import type { McpCaller } from '../mcp-server';

// The harness of the draft tools' tests: the shared Supabase double over one Event (FAL 2026,
// club `salle-lyon`) and its Tournament (Longsword Open), uuid ids in every row, plus a
// decoy of each table in another Event. `createDraftFromAction` is a double: the tools' own
// work is what they ask before it and what they answer from it.

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const EVENT = id(1);
export const ORG = id(2);
export const TOURNAMENT = id(3);
export const OTHER_EVENT = id(4);
export const DRAFT = id(5);
export const caller: McpCaller = { userId: id(90), email: 'marie@example.org', clientId: id(91) };

/** Where the draft opens: the assistant page of the Event, on this draft (call W). */
export const LINK = `https://admin.myclash.fr/org/salle-lyon/events/${EVENT}/ai-assistant?draft=${DRAFT}`;

export const world = { readOnly: false, eventStatus: 'published', phases: [] as SupabaseRow[] };

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

/** The decoys: another Event's Tournament `sabre-open`, Pools and bracket that are not ours. */
export const DECOY_PHASES: SupabaseRow[] = [
  { id: id(20), tournament_id: id(21), type: 'pool' },
  { id: id(22), tournament_id: TOURNAMENT, type: 'single_elim' },
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
  Object.assign(world, { readOnly: false, eventStatus: 'published', phases: [] });
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
          organization_id: ORG,
          organizations: { slug: 'salle-lyon' },
        }),
      ],
    },
    tournaments: {
      rows: [
        tournamentRow({
          id: id(21),
          event_id: OTHER_EVENT,
          slug: 'sabre-open',
          name: 'Sabre Open',
        }),
        tournamentRow({ id: TOURNAMENT, event_id: EVENT, slug: 'longsword-open' }),
      ],
    },
    phases: { rows: [...DECOY_PHASES, ...world.phases] },
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
