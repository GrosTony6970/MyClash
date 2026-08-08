import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ParticipantIdentityService } from './participant-identity.service';
import { mockSupabase, supabaseFrom } from '../../common/testing/supabase-chain';

const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';

function req(cookies: Record<string, string>): FastifyRequest {
  return { cookies } as unknown as FastifyRequest;
}

/** A SupabaseService double whose `anon.auth.getUser` answers for a claimed user. */
function supabaseWith(opts: { userId?: string | null; personId?: string | null }) {
  const from = supabaseFrom({
    persons: { data: opts.personId ? { id: opts.personId } : null, error: null },
  });
  return {
    service: { from },
    anon: {
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({ data: { user: opts.userId ? { id: opts.userId } : null } }),
        ),
      },
    },
    from,
  };
}

function guestJwt(payload: { person_id: string; event_id: string } | Error) {
  return {
    verify: vi.fn(() => {
      if (payload instanceof Error) throw payload;
      return payload;
    }),
  };
}

describe('ParticipantIdentityService — claimed accounts', () => {
  it('resolves the persons row for THIS event', async () => {
    const supabase = supabaseWith({ userId: 'user-1', personId: 'person-1' });
    const service = new ParticipantIdentityService(
      supabase as never,
      guestJwt(new Error()) as never,
    );

    await expect(service.resolvePersonId(req({ 'sb-access-token': 'tok' }), EVENT)).resolves.toBe(
      'person-1',
    );
  });

  it('prefers the account over a stale guest cookie on the same device', async () => {
    const supabase = supabaseWith({ userId: 'user-1', personId: 'person-claimed' });
    const guest = guestJwt({ person_id: 'person-guest', event_id: EVENT });
    const service = new ParticipantIdentityService(supabase as never, guest as never);

    await expect(
      service.resolvePersonId(req({ 'sb-access-token': 'tok', mc_guest: 'guest-tok' }), EVENT),
    ).resolves.toBe('person-claimed');
    expect(guest.verify).not.toHaveBeenCalled();
  });

  it('falls through when the account has no persons row at this event', async () => {
    const supabase = supabaseWith({ userId: 'user-1', personId: null });
    const service = new ParticipantIdentityService(
      supabase as never,
      guestJwt(new Error()) as never,
    );

    await expect(
      service.resolvePersonId(req({ 'sb-access-token': 'tok' }), EVENT),
    ).resolves.toBeNull();
  });
});

describe('ParticipantIdentityService — guest sessions', () => {
  it('resolves the person named by the guest JWT', async () => {
    const supabase = mockSupabase({});
    const guest = guestJwt({ person_id: 'person-guest', event_id: EVENT });
    const service = new ParticipantIdentityService(supabase as never, guest as never);

    await expect(service.resolvePersonId(req({ mc_guest: 'tok' }), EVENT)).resolves.toBe(
      'person-guest',
    );
  });

  it('REFUSES a guest cookie minted for a DIFFERENT event', async () => {
    // The bug this service was extracted to fix. The old private copy returned
    // payload.person_id without comparing event_id, so a tablet holding
    // Saturday's session resolved Saturday's person while browsing Sunday.
    // my-schedule filtered by event and looked merely empty; a pass would have
    // been ISSUED against the mismatched pair.
    const supabase = mockSupabase({});
    const guest = guestJwt({ person_id: 'person-guest', event_id: OTHER_EVENT });
    const service = new ParticipantIdentityService(supabase as never, guest as never);

    await expect(service.resolvePersonId(req({ mc_guest: 'tok' }), EVENT)).resolves.toBeNull();
  });

  it('treats an expired or forged guest token as no identity, not as an error', async () => {
    const supabase = mockSupabase({});
    const service = new ParticipantIdentityService(
      supabase as never,
      guestJwt(new Error('expired')) as never,
    );

    await expect(service.resolvePersonId(req({ mc_guest: 'tok' }), EVENT)).resolves.toBeNull();
  });
});

describe('ParticipantIdentityService.requirePersonId', () => {
  it('401s when neither identity is present', async () => {
    const supabase = mockSupabase({});
    const service = new ParticipantIdentityService(
      supabase as never,
      guestJwt(new Error()) as never,
    );

    await expect(service.requirePersonId(req({}), EVENT)).rejects.toThrow(
      /authentication required/i,
    );
  });

  it('returns the id when one is', async () => {
    const supabase = mockSupabase({});
    const guest = guestJwt({ person_id: 'person-guest', event_id: EVENT });
    const service = new ParticipantIdentityService(supabase as never, guest as never);

    await expect(service.requirePersonId(req({ mc_guest: 'tok' }), EVENT)).resolves.toBe(
      'person-guest',
    );
  });
});
