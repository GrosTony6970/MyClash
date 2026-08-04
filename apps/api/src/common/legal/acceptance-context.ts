/**
 * acceptance-context.ts — the request provenance stored beside an acceptance.
 *
 * One helper so every capture point records the same two fields the same way.
 * Neither is trusted or used for a decision: they exist so that "prove they
 * agreed" has an answer beyond a bare timestamp, and they are erased with the
 * rest of the subject's data.
 */
import type { FastifyRequest } from 'fastify';
import type { AcceptanceContext } from '../../modules/privacy/legal-acceptance.service';

export function requestAcceptanceContext(request: FastifyRequest): AcceptanceContext {
  return {
    ip: request.ip ?? null,
    userAgent:
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}
