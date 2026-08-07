import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { getActorId } from './actor';

describe('getActorId', () => {
  it('returns the id the platform guard stamped', () => {
    const req = { actorUserId: '11111111-1111-1111-1111-111111111111' } as FastifyRequest & {
      actorUserId: string;
    };
    expect(getActorId(req)).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('throws when the guard did not stamp the request', () => {
    // The behaviour this replaces returned the string 'unknown' (or
    // 'super-admin', or null) — which flowed into audit_log.actor_user_id, a
    // UUID column, where insertAuditLog swallowed the failure. A missing
    // stamp is a misconfigured route, so it must be loud.
    expect(() => getActorId({} as FastifyRequest)).toThrow(/actorUserId is not set/u);
  });

  it('treats an empty stamp as missing rather than as an actor', () => {
    expect(() => getActorId({ actorUserId: '' } as unknown as FastifyRequest)).toThrow(
      /actorUserId is not set/u,
    );
  });
});
