/**
 * apps/api/src/common/auth/request-user.ts
 *
 * Resolve the caller's user id from their Supabase JWT (cookie or Bearer).
 *
 * We deliberately do NOT read `req.actorUserId` here — that property is only
 * populated by `PlatformRoleGuard`, and organizer-facing controllers
 * intentionally don't use that guard (organizers aren't super-admins).
 * Reading it there would leave every `assertOrgRole(orgId, 'unknown', …)`
 * refusing real org admins. See LESSONS_LEARNED.md > Identity & auth.
 *
 * Two helpers. `resolveRequestUserId` returns the sentinel `'anonymous'` rather
 * than throwing, so callers keep control of the failure mode: a public read
 * serves it the public answer, and an org-role assertion turns it into a 401
 * (ruling 154). `requireRequestUserId` answers 401 itself, for routes no
 * signed-out caller may use at all. Both go through `getAuthUser`, which
 * verifies the token locally while GoTrue is unreachable: a GoTrue outage does
 * not turn a signed-in organiser into a stranger.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SupabaseService } from '../../modules/supabase/supabase.service';

export const ANONYMOUS_USER_ID = 'anonymous';

/**
 * The caller's user id, or 401 — for a route no anonymous caller may use.
 * The persons and registrations routes share it.
 */
export async function requireRequestUserId(
  req: FastifyRequest,
  supabase: SupabaseService,
): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user?.id) throw new UnauthorizedException('Invalid or expired session');
  return user.id;
}

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
  // Since ruling 154 the sentinel is a 401 at the org check, on which the web
  // client renews the login and retries: a GoTrue blip read as "no login" would
  // answer a signed-in organiser "session ended" and double the GoTrue calls.
  const user = await supabase.getAuthUser(token);
  return user?.id ?? ANONYMOUS_USER_ID;
}
