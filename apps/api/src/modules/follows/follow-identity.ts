import type { FastifyRequest } from 'fastify';
import type { GuestJwtService } from '../auth/guest-jwt.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { FollowIdentity } from './follows.service';

/**
 * Who follows, for a follows read or write: a signed-in user, else a guest session, else nobody.
 * The one owner, for the follows routes and the public person page's "do I follow them?".
 *
 * The login goes through `getAuthUser`: a GoTrue outage or 429 falls back to the local check
 * there. The raw `auth.getUser` it replaced answered such a hiccup as "signed out", so a
 * signed-in fan was told to sign in.
 */
export async function resolveFollowIdentity(
  req: FastifyRequest,
  supabase: SupabaseService,
  guestJwt: GuestJwtService,
): Promise<FollowIdentity> {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;

  // Try claimed user first
  const accessToken = cookies?.['sb-access-token'];
  if (accessToken) {
    const user = await supabase.getAuthUser(accessToken);
    if (user) return { userId: user.id };
  }

  // Try guest session
  const guestToken = cookies?.['mc_guest'];
  if (guestToken) {
    try {
      const payload = guestJwt.verify(guestToken);
      return { guestSessionId: payload.sub, guestEventId: payload.event_id };
    } catch {
      // Invalid token — anonymous
    }
  }

  return {};
}
