import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import type { McpCaller } from '../mcp-server';
import { confirmationKey } from './write-confirmation';
import { previewRefereeAssignment, type PreviewRefereeArgs } from './preview-referee-assignment';

// The harness of `preview_referee_assignment`'s tests: a recording Supabase double over one
// Event (FAL 2026), one Tournament (Longsword Open) and its bouts, UUID ids in every row.

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const EVENT = id(1);
export const ORG = id(2);
export const TOURNAMENT = id(3);
export const PHASE = id(4);
export const MATCH = id(5);
export const POOL = id(7);
export const LICE = id(8);
export const JEAN = id(10);
export const PAUL = id(11);
export const MARIE = id(12);
export const LUC = id(13);
export const MARC = id(14);

export const caller: McpCaller = { userId: id(90), email: 'marie@example.org', clientId: id(91) };
export const key = confirmationKey('test-secret');

/** A bout of the Tournament, as the matches select reads it. */
export function bout(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MATCH,
    match_number_label: 'M04',
    scheduled_at: '2026-03-14T10:00:00Z',
    pool_id: POOL,
    lice_id: LICE,
    lices: { name: 'Piste A' },
    phases: { config_json: {}, tournaments: { weapon: 'longsword' } },
    pools: { sort_order: 1 },
    bracket_slots: null,
    swiss_rounds: null,
    ...over,
  };
}

/** One active assignment row, as the crew read returns it. */
export function crewRow(
  person: string,
  role: string,
  scope: 'match' | 'pool' | 'lice',
): Record<string, unknown> {
  const names: Record<string, [string, string]> = {
    [JEAN]: ['Jean', 'Dupont'],
    [PAUL]: ['Paul', 'Martin'],
    [MARIE]: ['Marie', 'Curie'],
    [MARC]: ['Marc', 'Blanc'],
  };
  const [given_name, family_name] = names[person]!;
  return {
    person_id: person,
    role,
    scope_type: scope,
    match_id: scope === 'match' ? MATCH : null,
    pool_id: scope === 'pool' ? POOL : null,
    lice_id: scope === 'lice' ? LICE : null,
    global_persons: { given_name, family_name },
  };
}

export const DECLARANT = 'arbitre_declarant';
export const TABLE = 'arbitre_table';

/** What the world holds for one test; `resetWorld` sets it back. */
export const world = {
  readOnly: false,
  eventStatus: 'running',
  locked: false,
  bouts: [] as Record<string, unknown>[],
  crew: [] as Record<string, unknown>[],
  crewError: false,
  extraSkills: [] as { id: string; name: string; event_id: string | null }[],
};

export function resetWorld(): void {
  Object.assign(world, {
    readOnly: false,
    eventStatus: 'running',
    locked: false,
    bouts: [bout(), bout({ id: id(6), match_number_label: 'M05' })],
    crew: [],
    crewError: false,
    extraSkills: [],
  });
  calls.length = 0;
  assertOrgRole.mockReset().mockResolvedValue('editor');
  judgeVerdict.mockReset().mockResolvedValue(fine);
  listEventReferees.mockReset().mockResolvedValue(roster);
}

export const fine = {
  verdict: { level: 'fine', reasons: [] },
  matchIds: [MATCH],
  skippedMatchIds: [],
};

export const roster = [
  {
    personId: PAUL,
    displayName: 'Paul Martin',
    clubLabel: 'Salle Lyon',
    qualifications: [{ skillId: DECLARANT, rating: null }],
  },
  {
    personId: JEAN,
    displayName: 'Jean Dupont',
    clubLabel: null,
    qualifications: [{ skillId: DECLARANT, rating: null }],
  },
  {
    personId: LUC,
    displayName: 'Luc Paulin',
    clubLabel: 'Salle Nantes',
    qualifications: [{ skillId: TABLE, rating: null }],
  },
];

/** The crew read's projection. */
export const CREW_SELECT =
  'person_id, role, scope_type, match_id, pool_id, lice_id, global_persons(given_name, family_name)';

/** The projection of the public Tournament gate (`canReadTournament`). */
const VISIBILITY_SELECT = 'status, events!inner(id, status, organization_id, event_kind)';

function single(table: string, select: string): unknown {
  switch (table) {
    case 'events':
      if (select === 'organization_id') return { organization_id: ORG };
      return {
        id: EVENT,
        name: 'FAL 2026',
        slug: 'fal-2026',
        start_date: '2026-03-14',
        end_date: '2026-03-15',
        status: world.eventStatus,
        timezone: 'Europe/Paris',
        city: 'Lyon',
        country: 'FR',
        organization_id: ORG,
        event_kind: 'real',
      };
    case 'tournaments':
      if (select === 'id') return { id: TOURNAMENT };
      if (select === VISIBILITY_SELECT) {
        return {
          status: 'running',
          events: { id: EVENT, status: 'published', organization_id: ORG, event_kind: 'real' },
        };
      }
      return { name: 'Longsword Open', phases: [{ id: PHASE }] };
    case 'feature_flags':
      return { enabled: world.readOnly };
    case 'vw_tournament_query_matches':
      return { red_name: 'Anna Roux', blue_name: ' Bob Petit ' };
    default:
      return null;
  }
}

function list(table: string, select: string): { data: unknown; error: unknown } {
  if (table === 'referee_assignments' && select === 'id') {
    return { data: world.locked ? [{ id: id(30) }] : [], error: null };
  }
  if (table === 'referee_assignments') {
    return world.crewError
      ? { data: null, error: { message: 'connection reset' } }
      : { data: world.crew, error: null };
  }
  if (table === 'referee_skills') {
    return {
      data: [
        { id: DECLARANT, name: 'Déclarant', event_id: null },
        { id: TABLE, name: 'Table', event_id: null },
        { id: 'custom-fal-1', name: 'Juge de coin', event_id: EVENT },
        ...world.extraSkills,
      ],
      error: null,
    };
  }
  if (table === 'matches') return { data: world.bouts, error: null };
  return { data: [], error: null };
}

export interface Call {
  table: string;
  select: string;
  args: Record<string, unknown[][]>;
}

/** Every read the call made, in order. */
export const calls: Call[] = [];
export const assertOrgRole = vi.fn();
export const judgeVerdict = vi.fn();
export const listEventReferees = vi.fn();

function from(table: string) {
  const call: Call = { table, select: '', args: {} };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'in', 'or', 'limit', 'order']) {
    chain[name] = (...args: unknown[]) => {
      if (name === 'select') call.select = args[0] as string;
      (call.args[name] ??= []).push(args);
      return chain;
    };
  }
  chain['maybeSingle'] = () => Promise.resolve({ data: single(table, call.select), error: null });
  chain['then'] = (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) =>
    Promise.resolve(list(table, call.select)).then(ok, bad);
  return chain;
}

/** The read of `table` whose projection is `select`. */
export function readOf(table: string, select: string): Call {
  const found = calls.find((c) => c.table === table && c.select === select);
  if (!found) throw new Error(`no read of ${table} with ${select}`);
  return found;
}

export function deps(confirmKey: Buffer | null = key) {
  return {
    supabase: { service: { from } },
    orgs: { assertOrgRole },
    refereeBoard: { judgeVerdict },
    qualifications: { listEventReferees },
    confirmKey,
  } as never;
}

export function preview(over: Partial<PreviewRefereeArgs> = {}, confirmKey?: Buffer | null) {
  return previewRefereeAssignment(
    {
      event: 'fal-2026',
      tournament: 'longsword',
      match: 'lsw-p2-m04',
      role: 'declarant',
      referee: 'Paul Martin',
      ...over,
    },
    caller,
    deps(confirmKey),
  );
}

export const forbidden = () => new ForbiddenException('Requires editor role or higher');
