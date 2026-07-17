import type { FastifyRequest } from 'fastify';

/**
 * The caller of a request, as resolved by AuthGuard.
 *
 * Four kinds, matching the four identity mechanisms the API actually accepts.
 * `super_admin` is deliberately NOT a kind: it is a claimed user plus a
 * platform_roles lookup, and that lookup stays where it is (SuperAdminGuard).
 * Authentication here; authorization stays in the service layer.
 */
export type Identity =
  | { kind: 'claimed'; userId: string; email: string | null }
  | { kind: 'guest'; guestSessionId: string; personId: string; eventId: string }
  | { kind: 'staff'; staffId: string; eventId: string }
  | { kind: 'anonymous' };

export const ANONYMOUS: Identity = { kind: 'anonymous' };

/**
 * AuthGuard attaches the identity to BOTH the Fastify wrapper and `.raw`.
 *
 * This is not belt-and-braces, it is required. Nest hands guards the
 * FastifyRequest wrapper, but hands middleware `req.raw` — so
 * RequestLoggingMiddleware cannot see anything a guard writes to the wrapper
 * alone, and the actorId in request logs would silently stay undefined.
 */
export interface RequestWithIdentity extends FastifyRequest {
  identity?: Identity;
}

export function getIdentity(req: FastifyRequest): Identity {
  return (req as RequestWithIdentity).identity ?? ANONYMOUS;
}
