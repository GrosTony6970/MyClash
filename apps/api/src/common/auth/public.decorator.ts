import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is-public';

/**
 * Marks a route handler (or controller) as reachable without any identity.
 *
 * Semantics: "AuthGuard will not 401 you" — NOT "this route has no auth".
 * The guard still resolves identity and attaches it, so a @Public() route can
 * still tailor its response to the caller. `GET /me` is the canonical case: it
 * is @Public() *and* identity-aware, returning claimed / guest / anonymous.
 *
 * Absence of this decorator means the route requires an identity. That is the
 * whole point — it fails closed. Every use is a deliberate decision to expose a
 * route to the internet, and is asserted against real behaviour by the
 * anonymous-probe e2e spec rather than trusted from a list.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
