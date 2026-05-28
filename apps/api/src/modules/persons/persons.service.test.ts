import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonsService } from './persons.service';
import type { CreatePersonDto } from './dto/persons.dto';

/**
 * Tests for the participant-create matcher: `resolveOrCreateGlobalPerson`
 * runs inside `createPerson` and either reuses an existing global_persons
 * row (Tier 1: HEMA Ratings ID, Tier 2: name+club+DOB) or creates a fresh
 * one. The matcher is conservative — partial criteria never match.
 *
 * The supabase mock here is a small dispatcher: each `from(table)` call
 * returns a queryable chain that resolves to the result the test set up
 * for that table. Tests can also stub a sequence of results for the same
 * table when multiple queries hit it (e.g. email-uniqueness check before
 * the matcher runs).
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
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    // Make the chain itself thenable so `await chain` resolves to the result
    // (used when neither maybeSingle nor single is called — e.g. .limit(2)).
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

const baseDto: CreatePersonDto = {
  givenName: 'Jean',
  familyName: 'Dupont',
  email: 'jean@example.com',
} as CreatePersonDto;

describe('PersonsService.createPerson — global_persons matcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a fresh global_persons row when no matcher tier hits', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    // 1) email uniqueness check on persons → no match
    queueResult('persons', { data: null, error: null });
    // 2) resolveOrCreateGlobalPerson skips both tiers (no HEMA id, no DOB)
    //    and inserts into global_persons → returns id
    queueResult('global_persons', { data: { id: 'gp-new' }, error: null });
    // 3) persons insert → returns the row
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-new', clubs: null },
      error: null,
    });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
    );

    await service.createPerson('event-1', baseDto, 'actor-1');

    expect(insertCaptures['global_persons']).toHaveLength(1);
    expect(insertCaptures['persons']).toHaveLength(1);
    expect(insertCaptures['persons']![0]).toMatchObject({ global_person_id: 'gp-new' });
  });

  it('Tier 1: links to existing global_persons by HEMA Ratings ID', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    queueResult('persons', { data: null, error: null }); // email uniq
    // Tier 1 hit — single row from global_persons.limit(2)
    queueResult('global_persons', {
      data: [{ id: 'gp-existing-hema' }],
      error: null,
    });
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-existing-hema', clubs: null },
      error: null,
    });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, hemaRatingsId: '10458' } as CreatePersonDto,
      'actor-1',
    );

    // Did NOT insert a new global_persons row.
    expect(insertCaptures['global_persons']).toBeUndefined();
    expect(insertCaptures['persons']![0]).toMatchObject({
      global_person_id: 'gp-existing-hema',
    });
  });

  it('Tier 2: links by name + club + DOB when all three are provided', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    queueResult('persons', { data: null, error: null }); // email uniq
    // Tier 2 hit (no Tier 1 because no hemaRatingsId).
    queueResult('global_persons', {
      data: [{ id: 'gp-existing-name-club-dob' }],
      error: null,
    });
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-existing-name-club-dob', clubs: null },
      error: null,
    });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, clubId: 'club-1', dateOfBirth: '1990-04-15' } as CreatePersonDto,
      'actor-1',
    );

    expect(insertCaptures['global_persons']).toBeUndefined();
    expect(insertCaptures['persons']![0]).toMatchObject({
      global_person_id: 'gp-existing-name-club-dob',
    });
  });

  it('Tier 2 skipped when club is present but DOB is missing — creates fresh', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    queueResult('persons', { data: null, error: null });
    // Matcher should NOT query global_persons for Tier 2; goes straight to insert.
    queueResult('global_persons', { data: { id: 'gp-brand-new' }, error: null });
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-brand-new', clubs: null },
      error: null,
    });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, clubId: 'club-1' } as CreatePersonDto, // no DOB
      'actor-1',
    );

    // One global_persons.insert means Tier 2 was correctly skipped.
    expect(insertCaptures['global_persons']).toHaveLength(1);
    expect(insertCaptures['persons']![0]).toMatchObject({ global_person_id: 'gp-brand-new' });
  });

  it('Tier 1 ambiguous (≥2 matches) falls through to create (no false-merge)', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    queueResult('persons', { data: null, error: null });
    // Two hits on hema_ratings_id → considered ambiguous.
    queueResult('global_persons', {
      data: [{ id: 'gp-a' }, { id: 'gp-b' }],
      error: null,
    });
    // No DOB, so Tier 2 skipped; insert.
    queueResult('global_persons', { data: { id: 'gp-fresh' }, error: null });
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-fresh', clubs: null },
      error: null,
    });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, hemaRatingsId: '10458' } as CreatePersonDto,
      'actor-1',
    );

    expect(insertCaptures['persons']![0]).toMatchObject({ global_person_id: 'gp-fresh' });
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
    // 2) find_club_by_name RPC (called from the new resolveOrCreateClubByName)
    //    returns no match → fallthrough to insert
    //    NB: rpc() returns the chain too; makeChain treats the trailing .limit
    //    awaitable as the result.
    // 3) clubs insert → returns the new club id
    queueResult('clubs', { data: { id: 'club-new' }, error: null });
    // 4) global_persons matcher inserts a fresh row (no HEMA, no DOB)
    queueResult('global_persons', { data: { id: 'gp-new' }, error: null });
    // 5) persons insert → returns the row
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-new', club_id: 'club-new', clubs: null },
      error: null,
    });

    // Mock the RPC path used by resolveOrCreateClubByName.
    (supabase.service as unknown as { rpc: unknown }).rpc = vi.fn(() => ({
      limit: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, newClubName: 'Lyon AMHE' } as never,
      'actor-1',
    );

    // Club insert payload
    expect(insertCaptures['clubs']).toHaveLength(1);
    expect(insertCaptures['clubs']![0]).toMatchObject({
      name: 'Lyon AMHE',
      unverified: 'true',
    });
    // Person insert links to the new club id
    expect(insertCaptures['persons']).toHaveLength(1);
    expect(insertCaptures['persons']![0]).toMatchObject({ club_id: 'club-new' });
  });

  it('ignores newClubName when clubId is already provided (defensive)', async () => {
    // The DTO layer guards against both being set, but PersonsService should
    // still behave correctly if a future caller passes both: clubId wins.
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    queueResult('persons', { data: null, error: null }); // email uniq
    queueResult('global_persons', { data: { id: 'gp-new' }, error: null });
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-new', club_id: 'club-existing', clubs: null },
      error: null,
    });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
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
