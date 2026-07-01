import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonsService } from './persons.service';
import type { CreatePersonDto } from './dto/persons.dto';

/**
 * createPerson delegates global-identity resolution to
 * GlobalPersonResolverService (tested directly in
 * ../identity/global-person-resolver.service.test.ts). These tests mock the
 * resolver and assert createPerson wires it correctly — passes the right
 * inputs and links the new persons row to the id it returns.
 *
 * The supabase mock is a small dispatcher: each `from(table)` call returns a
 * queryable chain that resolves to the result the test queued for that table.
 */

type MockResult = { data: unknown; error: unknown };

function makeChain(result: MockResult, captureSelect?: (arg: string) => void) {
  const chain = {
    select: vi.fn((arg?: string) => {
      if (arg && captureSelect) captureSelect(arg);
      return chain;
    }),
    insert: vi.fn((_payload?: unknown) => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    in: vi.fn(() => chain),
    not: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    // Make the chain itself thenable so `await chain` resolves to the result.
    then: (resolve: (value: MockResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

interface TableQueue {
  results: MockResult[];
  selectArgs: string[];
}

function makeSupabase() {
  const queues = new Map<string, TableQueue>();
  const insertCaptures: Record<string, unknown[]> = {};

  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        if (!queues.has(table)) {
          queues.set(table, { results: [], selectArgs: [] });
        }
        const q = queues.get(table)!;
        const next = q.results.shift() ?? { data: null, error: null };
        const chain = makeChain(next, (arg) => q.selectArgs.push(arg));
        chain.insert.mockImplementation((payload: unknown) => {
          if (!insertCaptures[table]) insertCaptures[table] = [];
          insertCaptures[table]!.push(payload);
          return chain;
        });
        return chain;
      }),
    },
  };

  const queueResult = (table: string, result: MockResult) => {
    if (!queues.has(table)) queues.set(table, { results: [], selectArgs: [] });
    queues.get(table)!.results.push(result);
  };

  return { supabase, queueResult, insertCaptures };
}

/** A resolver stub that records its calls and returns a fixed identity. */
function makeResolver(result = { id: 'gp-new', created: true }) {
  return { resolveOrCreateGlobalPerson: vi.fn().mockResolvedValue(result) };
}

const baseDto: CreatePersonDto = {
  givenName: 'Jean',
  familyName: 'Dupont',
  email: 'jean@example.com',
} as CreatePersonDto;

describe('PersonsService.createPerson — global identity resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to the resolver and links the person to the resolved id', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    // 1) email uniqueness check on persons → no match
    queueResult('persons', { data: null, error: null });
    // 2) resolver returns the global id (mocked); createPerson inherits club_id
    //    from the global profile when the DTO carried none.
    queueResult('global_persons', { data: { club_id: null }, error: null });
    // 3) persons insert → returns the row
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-new', clubs: null },
      error: null,
    });

    const resolver = makeResolver();
    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
      resolver as never,
    );

    await service.createPerson('event-1', baseDto, 'actor-1');

    expect(resolver.resolveOrCreateGlobalPerson).toHaveBeenCalledWith(
      expect.objectContaining({
        givenName: 'Jean',
        familyName: 'Dupont',
        email: 'jean@example.com',
      }),
    );
    expect(insertCaptures['persons']).toHaveLength(1);
    expect(insertCaptures['persons']![0]).toMatchObject({ global_person_id: 'gp-new' });
  });

  it('skips the resolver when the caller supplies an explicit globalPersonId', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    queueResult('persons', { data: null, error: null }); // email uniq
    queueResult('persons', { data: null, error: null }); // global-profile dupe check
    queueResult('global_persons', { data: { club_id: null }, error: null }); // club inherit
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-explicit', clubs: null },
      error: null,
    });

    const resolver = makeResolver();
    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
      resolver as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, globalPersonId: 'gp-explicit' } as CreatePersonDto,
      'actor-1',
    );

    expect(resolver.resolveOrCreateGlobalPerson).not.toHaveBeenCalled();
    expect(insertCaptures['persons']![0]).toMatchObject({ global_person_id: 'gp-explicit' });
  });
});

describe('PersonsService.createPerson — newClubName branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a new unverified club and links the participant when newClubName is set', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    // 1) email uniqueness check → no match
    queueResult('persons', { data: null, error: null });
    // 2) clubs insert → returns the new club id
    queueResult('clubs', { data: { id: 'club-new' }, error: null });
    // 3) persons insert → returns the row
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-new', club_id: 'club-new', clubs: null },
      error: null,
    });

    // Mock the RPC path used by resolveOrCreateClubByName.
    (supabase.service as unknown as { rpc: unknown }).rpc = vi.fn(() => ({
      limit: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));

    const resolver = makeResolver();
    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
      resolver as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, newClubName: 'Lyon AMHE' } as never,
      'actor-1',
    );

    // Club insert payload
    expect(insertCaptures['clubs']).toHaveLength(1);
    expect(insertCaptures['clubs']![0]).toMatchObject({ name: 'Lyon AMHE', unverified: 'true' });
    // Resolver receives the freshly created club id.
    expect(resolver.resolveOrCreateGlobalPerson).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: 'club-new' }),
    );
    // Person insert links to the new club id
    expect(insertCaptures['persons']).toHaveLength(1);
    expect(insertCaptures['persons']![0]).toMatchObject({ club_id: 'club-new' });
  });

  it('ignores newClubName when clubId is already provided (defensive)', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    queueResult('persons', { data: null, error: null }); // email uniq
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-new', club_id: 'club-existing', clubs: null },
      error: null,
    });

    const resolver = makeResolver();
    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
      resolver as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, clubId: 'club-existing', newClubName: 'Should be ignored' } as never,
      'actor-1',
    );

    // No clubs insert fired
    expect(insertCaptures['clubs']).toBeUndefined();
    // Person linked to the existing club
    expect(insertCaptures['persons']![0]).toMatchObject({ club_id: 'club-existing' });
  });
});

// ── findGlobalPersonMatch (CSV preview-time matcher) ─────────────────────────
//
// Used by `previewImport` to populate `globalPersonMatch` + `defaultAction`
// on every CSV row. User reported re-importing the same 178-row CSV after a
// super-admin global import returned "173 To create, 5 To link" because the
// matcher was sampling the first 5 global_persons rows instead of querying
// by name. Tests pin the behaviour: filter by name (or HEMA id when
// available) so the candidate set actually contains the row we care about.

describe('PersonsService.findGlobalPersonMatch — narrow query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function invoke(
    service: PersonsService,
    givenName: string,
    familyName: string,
    hemaRatingsId?: string | null,
  ) {
    return (
      service as unknown as Record<
        string,
        (g: string, f: string, h?: string | null) => Promise<unknown>
      >
    )['findGlobalPersonMatch']!(givenName, familyName, hemaRatingsId);
  }

  function makeRecordingSupabase() {
    const calls: Record<string, Array<{ method: string; args: unknown[] }>> = {};
    const queues = new Map<string, { results: MockResult[] }>();

    function queueResult(table: string, result: MockResult) {
      if (!queues.has(table)) queues.set(table, { results: [] });
      queues.get(table)!.results.push(result);
    }

    const supabase = {
      service: {
        from: vi.fn((table: string) => {
          if (!calls[table]) calls[table] = [];
          if (!queues.has(table)) queues.set(table, { results: [] });
          const next = queues.get(table)!.results.shift() ?? { data: null, error: null };
          const record = (method: string) =>
            vi.fn((...args: unknown[]) => {
              calls[table]!.push({ method, args });
              return chain;
            });
          const chain = {
            select: record('select'),
            insert: record('insert'),
            update: record('update'),
            eq: record('eq'),
            ilike: record('ilike'),
            in: record('in'),
            not: record('not'),
            is: record('is'),
            order: record('order'),
            limit: record('limit'),
            maybeSingle: vi.fn(() => {
              calls[table]!.push({ method: 'maybeSingle', args: [] });
              return Promise.resolve(next);
            }),
            single: vi.fn(() => Promise.resolve(next)),
            then: (resolve: (value: MockResult) => unknown) => Promise.resolve(next).then(resolve),
          };
          return chain;
        }),
      },
    };

    return { supabase, queueResult, calls };
  }

  it('filters global_persons by name (not just .limit(5))', async () => {
    const { supabase, queueResult, calls } = makeRecordingSupabase();

    queueResult('global_persons', {
      data: [
        {
          id: 'gp-42',
          given_name: 'Adrián',
          family_name: 'Dader Laguna',
          display_name: 'Adrián Dader Laguna',
          clubs: { name: 'Gaudiosa Esgrima Histórica', abbreviation: null },
        },
      ],
      error: null,
    });
    queueResult('persons', { data: null, error: null });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
      makeResolver() as never,
    );

    const match = (await invoke(service, 'Adrián', 'Dader Laguna')) as { id: string } | null;

    expect(match).not.toBeNull();
    expect(match!.id).toBe('gp-42');

    const ilikeCalls = (calls['global_persons'] ?? []).filter((c) => c.method === 'ilike');
    expect(ilikeCalls.length).toBeGreaterThan(0);
    const familyCall = ilikeCalls.find((c) => c.args[0] === 'family_name');
    expect(familyCall).toBeDefined();
    expect(String(familyCall!.args[1])).toContain('Dader');
  });

  it('prefers HEMA-ID exact lookup when the CSV row carries a hema_ratings_id', async () => {
    const { supabase, queueResult, calls } = makeRecordingSupabase();

    queueResult('global_persons', {
      data: [
        {
          id: 'gp-hema-6282',
          given_name: 'Anthony',
          family_name: 'Garnier',
          display_name: 'Anthony Garnier',
          clubs: { name: 'Lyon AMHE', abbreviation: null },
        },
      ],
      error: null,
    });
    queueResult('persons', { data: { email: 'anthony.garnier70@gmail.com' }, error: null });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: (e: string) => e } as never,
      {} as never,
      makeResolver() as never,
    );

    const match = (await invoke(service, 'Anthony', 'Garnier', '6282')) as { id: string } | null;

    expect(match).not.toBeNull();
    expect(match!.id).toBe('gp-hema-6282');

    const eqCalls = (calls['global_persons'] ?? []).filter((c) => c.method === 'eq');
    const hemaCall = eqCalls.find((c) => c.args[0] === 'hema_ratings_id');
    expect(hemaCall).toBeDefined();
    expect(String(hemaCall!.args[1])).toBe('6282');
  });
});
