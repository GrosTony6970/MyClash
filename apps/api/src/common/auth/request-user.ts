/**
 * apps/api/src/common/auth/request-user.ts
 *
 * Resolve the caller's user id from their Supabase JWT (cookie or Bearer).
 *
 * We deliberately do NOT read `req.actorUserId` here — that property is only
 * populated by `PlatformRoleGuard`, and organizer-facing controllers
 * intentionally don't use that guard (organizers aren't super-admins).
 * Reading it there would leave every `assertOrgRole(orgId, 'unknown', …)`
 * throwing 403 for real org admins. See LESSONS_LEARNED.md > Identity & auth.
 *
 * Returns the sentinel `'anonymous'` rather than throwing, so callers keep
 * control of the failure mode: an org-role assertion turns it into a 403 with
 * a useful message, which is friendlier than a bare 401 from a helper.
 */
import type { FastifyRequest } from 'fastify';
import type { SupabaseService } from '../../modules/supabase/supabase.service';

export const ANONYMOUS_USER_ID = 'anonymous';

export async function resolveRequestUserId(
  req: FastifyRequest,
  supabase: SupabaseService,
): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return ANONYMOUS_USER_ID;
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id ?? ANONYMOUS_USER_ID;
}
