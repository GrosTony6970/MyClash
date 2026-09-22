import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalPersonResolverService, classifyMint } from './global-person-resolver.service';

/**
 * The supabase mock is a table-keyed dispatcher: each `from('global_persons')`
 * call shifts the next queued result. Tests queue results in the exact order
 * the resolver issues its queries (Tier 1 → 2 → 3 → email → mint → collision).
 *
 * `limit` TRUNCATES a queued list, rather than passing through. Without that a
 * `.limit(1)` put back on the email link changes nothing here, and the cases
 * below that exist to keep it off (the exact row seeded behind look-alikes)
 * cannot fail — the decision would be untested and the ruling 47 lesson lost.
 *
 * `select` strings are RECORDED, per table. Like every double here it answers
 * from its queue whatever the projection asks for, so a column dropped from a
 * read still arrives in the fixture and every assertion about the value stays
 * green — while PostgREST would hand back `undefined` and the decision reading
 * it would silently invert. The email link is exactly that shape.
 */
type MockResult = { data: unknown; error: unknown };

function makeChain(
  result: MockResult,
  onInsert?: (payload: unknown) => void,
  onSelect?: (columns: string) => void,
) {
  let current = result;
  const chain = {
    select: vi.fn((columns?: string) => {
      if (typeof columns === 'string') onSelect?.(columns);
      return chain;
    }),
    insert: vi.fn((payload?: unknown) => {
      if (payload !== undefined) onInsert?.(payload);
      return chain;
    }),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    is: vi.fn(() => chain),
    in: vi.fn(() => chain),
    limit: vi.fn((n: number) => {
      if (Array.isArray(current.data)) current = { ...current, data: current.data.slice(0, n) };
      return chain;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(current)),
    single: vi.fn(() => Promise.resolve(current)),
    then: (resolve: (value: MockResult) => unknown) => Promise.resolve(current).then(resolve),
  };
  return chain;
}

function makeSupabase() {
  const queues = new Map<string, MockResult[]>();
  const insertCaptures: Record<string, unknown[]> = {};
  const selectCaptures: Record<string, string[]> = {};

  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        if (!queues.has(table)) queues.set(table, []);
        const next = queues.get(table)!.shift() ?? { data: null, error: null };
        return makeChain(
          next,
          (payload) => {
            if (!insertCaptures[table]) insertCaptures[table] = [];
            insertCaptures[table]!.push(payload);
          },
          (columns) => {
            if (!selectCaptures[table]) selectCaptures[table] = [];
            selectCaptures[table]!.push(columns);
          },
        );
      }),
    },
  };

  const queue = (table: string, result: MockResult) => {
    if (!queues.has(table)) queues.set(table, []);
    queues.get(table)!.push(result);
  };

  return { supabase, queue, insertCaptures, selectCaptures };
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

    expect(res).toEqual({ id: 'gp-hema', created: false, mintReason: null });
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

    expect(res).toEqual({ id: 'gp-fresh', created: true, mintReason: 'first_sighting' });
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

    expect(res).toEqual({ id: 'gp-ncd', created: false, mintReason: null });
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

    expect(res).toEqual({ id: 'gp-nc', created: false, mintReason: null });
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

    expect(res).toEqual({ id: 'gp-fresh2', created: true, mintReason: 'first_sighting' });
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

    expect(res).toEqual({ id: 'gp-fresh3', created: true, mintReason: 'unmatchable' });
    expect(insertCaptures['global_persons']).toHaveLength(1);
    expect(insertCaptures['global_persons']![0]).toMatchObject({
      given_name: 'Jean',
      family_name: 'Dupont',
      is_fighter: true,
    });
  });

  it('links by email before minting when an identity already owns it', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', {
      data: [{ id: 'gp-email', email: 'jean@example.com' }],
      error: null,
    });

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: null,
      hemaRatingsId: null,
      dateOfBirth: null,
      email: 'jean@example.com',
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-email', created: false, mintReason: null });
    expect(insertCaptures['global_persons']).toBeUndefined();
  });

  it('on a mint email collision, links to the colliding row', async () => {
    const { supabase, queue } = makeSupabase();
    queue('global_persons', { data: [], error: null }); // email link → none
    queue('global_persons', { data: null, error: { message: 'duplicate key value' } }); // mint fails
    queue('global_persons', {
      data: [{ id: 'gp-collide', email: 'jean@example.com' }],
      error: null,
    }); // collision lookup

    const svc = new GlobalPersonResolverService(supabase as never);
    const res = await svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: null,
      hemaRatingsId: null,
      dateOfBirth: null,
      email: 'jean@example.com',
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-collide', created: false, mintReason: null });
  });
});

/**
 * Operator ruling 49(a), 2026-09-22 — the email link compares EXACTLY.
 *
 * The read is an `ilike`, where `_` is any one character and `%` any run, and a
 * roster email is whatever an organiser typed. So Marie's `m_martin@x.fr` found
 * Michel's `m.martin@x.fr` profile and linked her row to his identity; his next
 * sign-in then claimed her row along with his own (the sweep, ruling 49(b)).
 *
 * The verdict in each case is what the resolver DOES with the look-alike, not
 * the id it hands back: the old read ended in `.maybeSingle()`, so a queued
 * ARRAY is truthy and the old code returns `{ id: undefined }` — an assertion
 * that the id is "not Michel's" passes on the broken resolver. A mint, a throw
 * or the right id are the three outcomes that tell the two apart.
 */
describe('the email link compares the address exactly', () => {
  const LOOKALIKE = { id: 'gp-michel', email: 'm.martin@x.fr' };
  const TYPED = 'm_martin@x.fr';

  const resolve = (svc: GlobalPersonResolverService, email: string) =>
    svc.resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: null,
      hemaRatingsId: null,
      dateOfBirth: null,
      email,
      genderCategory: null,
    });

  it('mints rather than taking a profile that only matches as a wildcard', async () => {
    const { supabase, queue, insertCaptures, selectCaptures } = makeSupabase();
    queue('global_persons', { data: [LOOKALIKE], error: null }); // what `ilike` hands back
    queue('global_persons', { data: { id: 'gp-marie' }, error: null }); // mint

    const res = await resolve(new GlobalPersonResolverService(supabase as never), TYPED);

    expect(res).toEqual({ id: 'gp-marie', created: true, mintReason: 'first_sighting' });
    expect(insertCaptures['global_persons']).toHaveLength(1);
    expect(insertCaptures['global_persons']![0]).toMatchObject({ email: TYPED });
    // The address the comparison reads has to be in the projection. Dropped
    // from it, PostgREST hands back `undefined`, nothing ever matches exactly,
    // and the email tier stops linking at all — under a green suite, because
    // this double answers from its queue whatever the read asked for.
    expect(selectCaptures['global_persons']).toContain('id, email');
  });

  it('refuses the same look-alike on the duplicate-key retry', async () => {
    const { supabase, queue } = makeSupabase();
    queue('global_persons', { data: [], error: null }); // email link → none
    queue('global_persons', { data: null, error: { message: 'duplicate key value' } });
    queue('global_persons', { data: [LOOKALIKE], error: null }); // collision read

    await expect(
      resolve(new GlobalPersonResolverService(supabase as never), TYPED),
    ).rejects.toThrow(BadRequestException);
  });

  // The exact row is seeded LAST, behind two look-alikes: a `.limit()` on this
  // read would cut it off and mint a duplicate instead (the ruling 47 lesson).
  it('links the profile whose address is exactly the one typed, behind look-alikes', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', {
      data: [
        LOOKALIKE,
        { id: 'gp-other', email: 'mXmartin@x.fr' },
        { id: 'gp-marie', email: ' M_Martin@X.fr ' },
      ],
      error: null,
    });

    const res = await resolve(new GlobalPersonResolverService(supabase as never), TYPED);

    expect(res).toEqual({ id: 'gp-marie', created: false, mintReason: null });
    expect(insertCaptures['global_persons']).toBeUndefined();
  });

  // A claimed profile still wins the link: this tier reuses one identity across
  // events, it does not decide who owns it. Only a match LINKS — ruling 35 keeps
  // it from writing the organiser's typed details onto the row it found.
  it('links a profile that its own fighter has already claimed', async () => {
    const { supabase, queue, insertCaptures } = makeSupabase();
    queue('global_persons', {
      data: [LOOKALIKE, { id: 'gp-marie', email: TYPED, claimed_by_user_id: 'user-marie' }],
      error: null,
    });

    const res = await resolve(new GlobalPersonResolverService(supabase as never), TYPED);

    expect(res).toEqual({ id: 'gp-marie', created: false, mintReason: null });
    expect(insertCaptures['global_persons']).toBeUndefined();
  });
});

/**
 * The classifier answers one question: can any matching tier EVER fire for
 * these identifiers? Each case is written from the tier requirements directly
 * (tier 1 needs a ratings id, tiers 2 and 3 need a club, the email tier needs
 * an email) rather than from the classifier's own implementation, so a change
 * that widens the tiers without widening the classifier fails here.
 */
describe('classifyMint', () => {
  it('is unmatchable with no club, no ratings id and no email', () => {
    expect(classifyMint({ clubId: null, hemaRatingsId: null, email: null })).toBe('unmatchable');
  });

  it.each([
    ['a club feeds tiers 2 and 3', { clubId: 'club-1', hemaRatingsId: null, email: null }],
    ['a ratings id feeds tier 1', { clubId: null, hemaRatingsId: '10458', email: null }],
    ['an email feeds the email tier', { clubId: null, hemaRatingsId: null, email: 'j@e.com' }],
  ])('is a first sighting when %s', (_label, identifiers) => {
    expect(classifyMint(identifiers)).toBe('first_sighting');
  });

  it('treats an empty-string identifier as absent, matching the tier guards', () => {
    // The resolver normalizes `'   '` to null before any tier runs; the
    // classifier must agree, or it would promise a link that never happens.
    expect(classifyMint({ clubId: '', hemaRatingsId: '', email: '' })).toBe('unmatchable');
  });
});
