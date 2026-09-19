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
 * Two helpers. `resolveRequestUserId` returns the sentinel `'anonymous'` rather
 * than throwing, so callers keep control of the failure mode: an org-role
 * assertion turns it into a 403 with a useful message. `requireRequestUserId`
 * answers 401 itself, for routes that tell "signed out" from "not allowed".
 */
import { UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SupabaseService } from '../../modules/supabase/supabase.service';

export const ANONYMOUS_USER_ID = 'anonymous';

/**
 * The caller's user id, or 401 — for a route no anonymous caller may use.
 *
 * Unlike `resolveRequestUserId` below, this goes through `getAuthUser`, which
 * falls back to verifying the token locally while GoTrue is unreachable: a
 * GoTrue outage does not turn a signed-in organiser into a stranger. The
 * persons and registrations routes share it.
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
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id ?? ANONYMOUS_USER_ID;
}
