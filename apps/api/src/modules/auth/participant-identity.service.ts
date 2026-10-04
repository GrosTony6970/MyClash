import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { GuestJwtService, type GuestJwtPayload } from './guest-jwt.service';

/**
 * "Which `persons` row is the caller, at this event?"
 *
 * The one owner of that question for participant-facing routes. It has two
 * answers because participants reach MyClash two ways: a claimed account
 * (`sb-access-token`, a real Supabase user) or a guest session (`mc_guest`, a
 * device that picked itself off the roster and has no account at all). At a real
 * HEMA event the guest path is the mainstream one, so any surface that serves
 * only the first is invisible to most of the people standing in front of it.
 *
 * Extracted from `my-schedule.controller.ts`, which had it as a private method
 * and was the only caller until the event pass needed the same answer. Copying
 * it would have meant two definitions of who a participant is, drifting apart —
 * and the copy would have inherited the bug below.
 *
 * NOTE the event check on the guest branch. The original returned the JWT's
 * `person_id` without comparing its `event_id` to the event being asked about,
 * so a device holding Saturday's guest session and browsing Sunday's event
 * resolved to Saturday's person. `my-schedule` then filtered by event and came
 * back empty, which hid it; a pass would have been ISSUED against the mismatched
 * pair. The guest JWT names its event — trust that, and refuse when it disagrees.
 */
@Injectable()
export class ParticipantIdentityService {
  constructor(
    // Value imports, not `import type` — a type-only import erases the metadata
    // Nest needs to resolve these.
    private readonly supabase: SupabaseService,
    private readonly guestJwt: GuestJwtService,
  ) {}

  /**
   * The caller's `persons.id` at `eventId`, or 401.
   *
   * Claimed first, guest second: someone who has an account AND an old guest
   * cookie on the same device should resolve to their real identity.
   */
  async requirePersonId(req: FastifyRequest, eventId: string): Promise<string> {
    const personId = await this.resolvePersonId(req, eventId);
    if (!personId) throw new UnauthorizedException('Authentication required');
    return personId;
  }

  /** As `requirePersonId`, but `null` instead of throwing. */
  async resolvePersonId(req: FastifyRequest, eventId: string): Promise<string | null> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    return (
      (await this.fromClaimedUser(cookies?.['sb-access-token'], eventId)) ??
      (await this.fromGuestSession(cookies?.['mc_guest'], eventId))
    );
  }

  /**
   * A claimed account.
   *
   * The person lookup is scoped to THIS event on purpose: `persons` is
   * event-scoped, so a user claimed at six events has six rows and an unscoped
   * query resolves to an arbitrary one.
   *
   * Neither read may answer "nobody" when it failed. The login goes through
   * `getAuthUser`, which checks the token itself when GoTrue cannot be asked; the
   * raw GoTrue read that stood here answered a blip as "signed out". A roster
   * read that fails throws: read as "no row", the caller got a 401 and a page
   * drew "Register" on a seat she holds.
   */
  private async fromClaimedUser(
    accessToken: string | undefined,
    eventId: string,
  ): Promise<string | null> {
    if (!accessToken) return null;
    const user = await this.supabase.getAuthUser(accessToken);
    if (!user) return null;

    const { data: person, error } = await this.supabase.service
      .from('persons')
      .select('id')
      .eq('claimed_by_user_id', user.id)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) {
      throw new Error(`Roster row of ${user.id} at ${eventId} unreadable: ${error.message}`);
    }
    return (person as { id: string } | null)?.id ?? null;
  }

  /**
   * A guest session.
   *
   * The JWT carries `{ person_id, event_id }`, so the event is checkable and is
   * checked — see the class note. A cookie for another event is treated as no
   * identity here rather than as an error: the caller may still be a claimed
   * user, and a stale guest cookie is a normal thing for a shared tablet to be
   * carrying.
   *
   * A signed-out session is no identity either. "Sign out this device" stamps
   * `revoked_at` on the session row and the cookie's signature stays valid until
   * the Event ends + 7 days, so only the row can say the session is over. A
   * failed read throws rather than answering "signed out": it is not a verdict,
   * and treating it as one would sign every guest out on a database blip.
   *
   * A session on a name an account holds is no identity (operator ruling 265).
   * A guest session takes no proof, so on such a name it would let anybody read
   * and act as the account's holder. No new one is opened there
   * (`guest-sessions.controller.ts`); this ends the ones opened before the claim.
   * Only a person the read hands back with no holder passes.
   */
  private async fromGuestSession(
    guestToken: string | undefined,
    eventId: string,
  ): Promise<string | null> {
    if (!guestToken) return null;
    let payload: GuestJwtPayload;
    try {
      payload = this.guestJwt.verify(guestToken);
    } catch {
      // Expired or forged. Indistinguishable from absent, and treated the same.
      return null;
    }
    if (payload.event_id !== eventId) return null;

    const { data, error } = await this.supabase.service
      .from('guest_sessions')
      .select('revoked_at, persons ( claimed_by_user_id )')
      .eq('id', payload.sub)
      .maybeSingle();
    if (error) throw new Error(`Guest session ${payload.sub} unreadable: ${error.message}`);
    const session = data as { revoked_at: string | null; persons?: unknown } | null;
    if (!session || session.revoked_at) return null;
    // PostgREST embeds a to-one parent as an object; the typed client says array.
    const person = (Array.isArray(session.persons) ? session.persons[0] : session.persons) as
      { claimed_by_user_id: string | null } | null | undefined;
    return person?.claimed_by_user_id === null ? payload.person_id : null;
  }
}
