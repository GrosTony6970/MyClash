import type { FastifyRequest } from 'fastify';

/**
 * The route the router matched for this request, e.g. `/api/v1/orgs/:orgId/events`.
 *
 * A check that refuses by address reads this, never `request.url`. The router decodes an address
 * before it matches it, and reads an absolute-form target (`http://host/api/v1/...`) as its path:
 * `/api/v1/%6Frgs/...` and `http://host/api/v1/orgs/...` both reach the `orgs` handlers, and
 * neither raw text starts with `/api/v1/orgs/`. A query string is no part of the route either.
 * The raw text can be spelled to miss a prefix, not to hit one: the router resolves no `..` and
 * splits no `%2F`. So a check that lets an address through by its raw prefix (the read-only
 * switch's allowlist) fails closed, as long as no route with a parameter sits on an allowed
 * prefix: a `PATCH /api/v1/staff/:id` would let `PATCH /api/v1/staff/heartbeat` through.
 *
 * Behind the router every request has one. A hand-built request without it throws: a check that
 * cannot place a request must not answer for it.
 */
export function matchedRoute(request: FastifyRequest): string {
  const pattern = request.routeOptions?.url;
  if (!pattern) throw new Error(`${request.method} ${request.url}: no matched route to read`);
  return pattern;
}
