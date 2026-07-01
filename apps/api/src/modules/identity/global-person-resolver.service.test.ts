import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalPersonResolverService } from './global-person-resolver.service';

/**
 * The supabase mock is a table-keyed dispatcher: each `from('global_persons')`
 * call shifts the next queued result. Tests queue results in the exact order
 * the resolver issues its queries (Tier 1 → 2 → 3 → email → mint → collision).
 */
type MockResult = { data: unknown; error: unknown };

function makeChain(result: MockResult, onInsert?: (payload: unknown) => void) {
  const chain = {
    select: vi.fn(() => chain),
    insert: vi.fn((payload?: unknown) => {
      if (payload !== undefined) onInsert?.(payload);
      return chain;
    }),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    is: vi.fn(() => chain),
    in: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: MockResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function makeSupabase() {
  const queues = new Map<string, MockResult[]>();
  const insertCaptures: Record<string, unknown[]> = {};

  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        if (!queues.has(table)) queues.set(table, []);
        const next = queues.get(table)!.shift() ?? { data: null, error: null };
        return makeChain(next, (payload) => {
          if (!insertCaptures[table]) insertCaptures[table] = [];
          insertCaptures[table]!.push(payload);
        });
      }),
    },
  };

  const queue = (table: string, result: MockResult) => {
    if (!queues.has(table)) queues.set(table, []);
    queues.get(table)!.push(result);
  };

  return { supabase, queue, insertCaptures };
}

const NAME = { givenName: 'Jean', familyName: 'Dupont' };

describe('GlobalPersonResolverService.resolveOrCreateGlobalPerson', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Tier 1 — links to a single hema_ratings_id match', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', {
      data: [{ id: 'gp-hema', email: null, date_of_birth: null }],
      error: null,
    });

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: 'club-1',
      hemaRatingsId: '10458',
      dateOfBirth: null,
      email: null,
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-hema', created: false });
    expect(insertCaptures['global_persons']).toBeUndefined();
  });

  it('Tier 1 ambiguous (≥2 hits) falls through and mints', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', { data: [{ id: 'a' }, { id: 'b' }], error: null }); // Tier 1 ambiguous
    queue('global_persons', { data: { id: 'gp-fresh' }, error: null }); // mint

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: null,
      hemaRatingsId: '10458',
      dateOfBirth: null,
      email: null,
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-fresh', created: true });
    expect(insertCaptures['global_persons']).toHaveLength(1);
  });

  it('Tier 2 — links by name + club + DOB', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', {
      data: [{ id: 'gp-ncd', email: null, date_of_birth: '1990-04-15' }],
      error: null,
    });

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: 'club-1',
      hemaRatingsId: null,
      dateOfBirth: '1990-04-15',
      email: null,
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-ncd', created: false });
    expect(insertCaptures['global_persons']).toBeUndefined();
  });

  it('Tier 3 — links by unique name + club when no DOB (the E2E-7 dedup case)', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', {
      data: [{ id: 'gp-nc', email: null, date_of_birth: null }],
      error: null,
    });

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: 'club-1',
      hemaRatingsId: null,
      dateOfBirth: null,
      email: null,
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-nc', created: false });
    expect(insertCaptures['global_persons']).toBeUndefined();
  });

  it('Tier 3 ambiguous (≥2 hits) mints fresh — no false merge', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', { data: [{ id: 'x' }, { id: 'y' }], error: null }); // Tier 3 ambiguous
    queue('global_persons', { data: { id: 'gp-fresh2' }, error: null }); // mint

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: 'club-1',
      hemaRatingsId: null,
      dateOfBirth: null,
      email: null,
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-fresh2', created: true });
    expect(insertCaptures['global_persons']).toHaveLength(1);
  });

  it('mints fresh when there is no club (name tiers are skipped)', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', { data: { id: 'gp-fresh3' }, error: null }); // mint only

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: null,
      hemaRatingsId: null,
      dateOfBirth: null,
      email: null,
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-fresh3', created: true });
    expect(insertCaptures['global_persons']).toHaveLength(1);
    expect(insertCaptures['global_persons']![0]).toMatchObject({
      given_name: 'Jean',
      family_name: 'Dupont',
      is_fighter: true,
    });
  });

  it('links by email before minting when an identity already owns it', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', { data: { id: 'gp-email' }, error: null }); // email link (maybeSingle)

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: null,
      hemaRatingsId: null,
      dateOfBirth: null,
      email: 'jean@example.com',
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-email', created: false });
    expect(insertCaptures['global_persons']).toBeUndefined();
  });

  it('on a mint email collision, links to the colliding row', async () => {
    const { supabase, queue } = makeSupabase();
    queue('global_persons', { data: null, error: null }); // email link → none
    queue('global_persons', { data: null, error: { message: 'duplicate key value' } }); // mint fails
    queue('global_persons', { data: { id: 'gp-collide' }, error: null }); // collision lookup

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: null,
      hemaRatingsId: null,
      dateOfBirth: null,
      email: 'jean@example.com',
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-collide', created: false });
  });
});
