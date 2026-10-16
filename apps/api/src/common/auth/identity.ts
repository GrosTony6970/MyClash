import type { FastifyRequest } from 'fastify';

/**
 * The caller of a request, as resolved by AuthGuard.
 *
 * Four kinds, matching the four identity mechanisms the API actually accepts.
 * `super_admin` is deliberately NOT a kind: it is a claimed user plus a
 * platform_roles lookup, and that lookup stays where it is (PlatformRoleGuard).
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
  /**
   * The request's verified staff cookie, whichever identity won. A device can
   * carry two cookies — a scoring pad where someone once signed in keeps the
   * login, which is set on the parent domain — and `identity` keeps only the
   * first (claimed > guest > staff). A check that needs the staff session reads
   * this. Wrapper only: no middleware reads it.
   */
  staffSession?: StaffSession | null;
}

export interface StaffSession {
  staffId: string;
  eventId: string;
}

export function getIdentity(req: FastifyRequest): Identity {
  return (req as RequestWithIdentity).identity ?? ANONYMOUS;
}

/** The login the request carries: a `Bearer` header, else the login cookie. Not verified here. */
export function presentedLogin(req: FastifyRequest): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return (
    (req as FastifyRequest & { cookies?: Record<string, string> }).cookies?.['sb-access-token'] ??
    null
  );
}

/**
 * The request carries a login that did not verify, and no other identity: in the
 * browser that is a login whose hour is up. Only a 401 makes the browser renew it
 * (`fetchRenewingLogin`); a route that reads it as a stranger answers what a stranger
 * gets, and nothing renews it.
 */
export function carriesEndedLogin(req: FastifyRequest): boolean {
  return getIdentity(req).kind === 'anonymous' && presentedLogin(req) !== null;
}

/** Signature and expiry only: whether the account is still active is the caller's check. */
export function getStaffSession(req: FastifyRequest): StaffSession | null {
  return (req as RequestWithIdentity).staffSession ?? null;
}
