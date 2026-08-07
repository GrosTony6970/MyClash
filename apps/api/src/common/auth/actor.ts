/**
 * apps/api/src/common/auth/actor.ts
 *
 * The caller's user id on a platform-guarded route, for audit attribution.
 *
 * Sixteen admin controllers each carried their own copy of this three-line
 * helper, under three different names (`getActorId`, `actorUserId`, `actorOf`)
 * and with FOUR different behaviours when the property was absent: the string
 * `'unknown'` (thirteen of them), the string `'super-admin'`
 * (hema-ratings-admin), `null` (runtime-health), and a thrown Error
 * (privacy-admin). Only the last is right, and this module makes it the only
 * one.
 *
 * ## Why throwing beats a sentinel
 *
 * `audit_log.actor_user_id` is a UUID column and `insertAuditLog` is
 * best-effort — it logs a warning and never fails the mutation. So a sentinel
 * string does not surface as an error at the call site; it surfaces as an
 * audit row that was never written, discovered months later when someone asks
 * who did something. A 500 is a worse afternoon and a much better failure: it
 * is loud, immediate, and attributable.
 *
 * This is safe precisely because the property is set by the platform guard,
 * which every caller of this function sits behind. If it is ever missing, the
 * guard is misconfigured — which is exactly the bug worth crashing on rather
 * than papering over. See ENGINEERING_LESSONS > Identity & auth: on routes that
 * do NOT use the platform guard, resolve the caller with `resolveRequestUserId`
 * instead — never reach for this one.
 */
import type { PlatformRole } from '@myclash/types';
import type { FastifyRequest } from 'fastify';

/** Shape the platform guard stamps onto the request after verifying the tier. */
export type ActorRequest = FastifyRequest & {
  actorUserId?: string;
  platformRole?: PlatformRole;
};

/**
 * The verified caller's user id.
 *
 * @throws if the platform guard did not stamp the request — a misconfigured
 * route, never a user-supplied condition.
 */
export function getActorId(req: FastifyRequest): string {
  const actor = (req as ActorRequest).actorUserId;
  if (!actor) {
    throw new Error(
      'actorUserId is not set on this request. A platform guard must run before getActorId(); ' +
        'on an unguarded route use resolveRequestUserId() instead.',
    );
  }
  return actor;
}

/**
 * The tier the caller holds, for controllers and services that need to branch
 * BELOW the guard — shaping a response rather than deciding access. Access
 * decisions belong in the guard, not here.
 *
 * Returns `null` rather than throwing, because unlike an actor id this is
 * legitimately absent on any route the platform guard did not run on.
 */
export function getPlatformRole(req: FastifyRequest): PlatformRole | null {
  return (req as ActorRequest).platformRole ?? null;
}
