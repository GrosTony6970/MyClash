import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMe, ME_PATH, type MeAdmin, type MeSession } from './me';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(impl as unknown as typeof fetch);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The shape assertions below are the point of this file, and they are checked by
 * `pnpm --filter @myclash/api-client typecheck` rather than by `vitest run` —
 * tsconfig.json's include covers the colocated tests for exactly this reason.
 *
 * They exist because the generated type was `Record<string, never>` for four
 * members until 2026-08-20, and nothing noticed for months: `quality:openapi-drift`
 * only proves the committed schema matches the emitted spec, and it will commit
 * a hollow one just as happily. If the DTO loses its nested classes again, this
 * file stops compiling.
 */
describe('MeSession is the generated shape, not a hollow one', () => {
  it('admits a fully-populated payload', () => {
    const me: MeSession = {
      type: 'claimed',
      user: { id: 'u1', email: 'a@b.c', display_name: 'A', photo_url: 'p' },
      person: {
        id: 'p1',
        given_name: 'A',
        family_name: 'B',
        event_id: 'e1',
        claim_status: 'claimed',
      },
      admin: {
        platformRole: 'super_admin',
        organizations: [{ id: 'o1', slug: 'club', name: 'Club', role: 'owner' }],
        hasLeagueRoles: true,
      },
      session: { device_label: 'Pad 1', expires_at: '2026-01-01T00:00:00Z' },
      pendingLegal: ['terms'],
    };

    // Reading them is half the assertion: a `Record<string, never>` would accept
    // the literal above under a widening cast but has nothing to read here.
    expect(me.admin?.platformRole).toBe('super_admin');
    expect(me.admin?.organizations[0]?.name).toBe('Club');
    expect(me.user?.email).toBe('a@b.c');
    expect(me.person?.family_name).toBe('B');
    expect(me.session?.device_label).toBe('Pad 1');
  });

  it('models an org owner with no platform tier', () => {
    const admin: MeAdmin = { platformRole: null, organizations: [] };
    expect(admin.platformRole).toBeNull();
  });

  it('does not admit a `user` discriminant', () => {
    // THE bug this slice removes. `apps/web-staff/app/lices/page.tsx` gated on
    // `me.type !== 'user'` behind a `{ type: string }` cast, so the fallback to a
    // full account session could never pass and every PIN-less staff member was
    // bounced to /login. `/me` emits claimed | guest | anonymous and never has.
    //
    // @ts-expect-error — if this stops erroring, the union was widened and that
    // gate's dead branch has quietly become writable again.
    const bad: MeSession['type'] = 'user';
    expect(bad).toBe('user');
  });
});

describe('fetchMe', () => {
  it('reads /api/v1/me with credentials and returns the body', async () => {
    const spy = stubFetch(() => json({ type: 'anonymous' }));
    const result = await fetchMe('https://api.example');

    expect(spy.mock.calls[0]?.[0]).toBe(`https://api.example${ME_PATH}`);
    expect((spy.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
    expect(result).toEqual({ ok: true, data: { type: 'anonymous' } });
  });

  it('treats anonymous as an answer, not a failure', async () => {
    stubFetch(() => json({ type: 'anonymous' }));
    const result = await fetchMe('');
    // The distinction the whole slice turns on: signed out is a 200. A caller
    // that reads `ok === false` as "signed out" is reading an outage.
    expect(result.ok).toBe(true);
  });

  it('reports an unreachable API as network, never as signed out', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const result = await fetchMe('');
    expect(result).toEqual({ ok: false, kind: 'network' });
  });
});
