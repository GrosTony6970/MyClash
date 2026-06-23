import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Service for the §8 organizer-approval queue.
 *
 * A queue row is created when a public user clicks "This is me" on a
 * global_persons profile whose `email` column is NULL (set by Slice F
 * in auth.service.requestGlobalPersonClaim). Decisions land here.
 *
 * Permission model:
 *  - super-admin can list / approve / reject everything.
 *  - an organizer can act on a request when the target global_person_id
 *    is referenced by a persons row in any event owned by an org they
 *    belong to with organizer role.
 */
@Injectable()
export class ClaimRequestsService {
  private readonly logger = new Logger(ClaimRequestsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mail: MailService,
  ) {}

  /** Super-admin: every pending request across the platform. */
  async listAllPending() {
    const { data, error } = await this.supabase.service
      .from('global_person_claim_requests')
      .select(
        'id, user_id, global_person_id, status, requested_at, decided_at, decision_reason, global_persons(id, display_name, given_name, family_name, country_code, hema_ratings_id, clubs(name))',
      )
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const userIds = Array.from(
      new Set(rows.map((r) => r['user_id']).filter((id): id is string => typeof id === 'string')),
    );
    const userMap = await this.loadUserEmails(userIds);

    return rows.map((r) => {
      const gp = r['global_persons'] as {
        id: string;
        display_name: string;
        given_name: string;
        family_name: string;
        country_code: string | null;
        hema_ratings_id: string | null;
        clubs: { name: string } | { name: string }[] | null;
      } | null;
      const club = gp?.clubs
        ? Array.isArray(gp.clubs)
          ? (gp.clubs[0]?.name ?? null)
          : gp.clubs.name
        : null;
      return {
        id: r['id'] as string,
        userId: r['user_id'] as string,
        requesterEmail: userMap.get(r['user_id'] as string) ?? null,
        requestedAt: r['requested_at'] as string,
        globalPerson: gp
          ? {
              id: gp.id,
              displayName: gp.display_name,
              givenName: gp.given_name,
              familyName: gp.family_name,
              countryCode: gp.country_code,
              hemaRatingsId: gp.hema_ratings_id,
              clubLabel: club,
            }
          : null,
      };
    });
  }

  async approve(requestId: string, actorUserId: string): Promise<void> {
    const request = await this.loadPendingOrThrow(requestId);

    // Permission check: super-admin OR organizer of an event the global
    // person participates in. The super-admin guard at the controller
    // level grants the first branch; we re-verify the org membership for
    // the organizer branch when added in a follow-up sub-tab. Today the
    // controller is super-admin-only, so we just proceed.

    // Race-guard: only set claimed_by_user_id if still null.
    const { data: updated, error: updateError } = await this.supabase.service
      .from('global_persons')
      .update({
        claimed_by_user_id: request.user_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.global_person_id)
      .is('claimed_by_user_id', null)
      .select('id, email')
      .maybeSingle();
    if (updateError) {
      throw new ServiceUnavailableException(updateError.message);
    }
    if (!updated) {
      // Someone (autolink, another approval, manual fix) already claimed.
      await this.markDecided(requestId, 'rejected', actorUserId, 'already_claimed');
      throw new BadRequestException('Profile is already claimed');
    }

    // Backfill global_persons.email with the requester's auth email if
    // currently NULL — keeps the unique-email guarantee growing so a
    // future login can autolink without re-queueing.
    const requesterEmail = await this.lookupUserEmail(request.user_id);
    if (requesterEmail && !(updated as { email?: string | null }).email) {
      await this.supabase.service
        .from('global_persons')
        .update({ email: requesterEmail.toLowerCase() })
        .eq('id', request.global_person_id);
    }

    await this.markDecided(requestId, 'approved', actorUserId, null);
    this.logger.log(
      `claim-request approved: ${requestId} (user ${request.user_id} → global_persons ${request.global_person_id}) by ${actorUserId}`,
    );

    if (requesterEmail) {
      await this.notifyRequester(requesterEmail, 'approved', null);
    }
  }

  async reject(requestId: string, actorUserId: string, reason: string): Promise<void> {
    const request = await this.loadPendingOrThrow(requestId);
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new BadRequestException('A rejection reason is required');
    }

    await this.markDecided(requestId, 'rejected', actorUserId, trimmedReason);
    this.logger.log(
      `claim-request rejected: ${requestId} (user ${request.user_id} → global_persons ${request.global_person_id}) by ${actorUserId} — ${trimmedReason}`,
    );

    const requesterEmail = await this.lookupUserEmail(request.user_id);
    if (requesterEmail) {
      await this.notifyRequester(requesterEmail, 'rejected', trimmedReason);
    }
  }

  private async loadPendingOrThrow(requestId: string): Promise<{
    user_id: string;
    global_person_id: string;
    status: string;
  }> {
    const { data, error } = await this.supabase.service
      .from('global_person_claim_requests')
      .select('user_id, global_person_id, status')
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Claim request not found');
    const row = data as { user_id: string; global_person_id: string; status: string };
    if (row.status !== 'pending') {
      throw new BadRequestException(`Request is already ${row.status}`);
    }
    return row;
  }

  private async markDecided(
    requestId: string,
    status: 'approved' | 'rejected',
    actorUserId: string,
    reason: string | null,
  ): Promise<void> {
    const { error } = await this.supabase.service
      .from('global_person_claim_requests')
      .update({
        status,
        decided_at: new Date().toISOString(),
        decided_by_user_id: actorUserId,
        decision_reason: reason,
      })
      .eq('id', requestId);
    if (error) throw new ServiceUnavailableException(error.message);
  }

  private async lookupUserEmail(userId: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.service.auth.admin.getUserById(userId);
      if (error || !data?.user) return null;
      return data.user.email ?? null;
    } catch {
      return null;
    }
  }

  private async loadUserEmails(userIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of userIds) {
      const email = await this.lookupUserEmail(id);
      if (email) out.set(id, email);
    }
    return out;
  }

  private async notifyRequester(
    email: string,
    decision: 'approved' | 'rejected',
    reason: string | null,
  ): Promise<void> {
    try {
      if (decision === 'approved') {
        await this.mail.sendNotification({
          to: email,
          subject: 'Profil MyClash confirmé / MyClash profile confirmed',
          title: 'Profil confirmé / Profile confirmed',
          body: 'Votre demande de revendication de profil global a été approuvée. Vous pouvez maintenant le retrouver dans votre espace personnel. / Your global profile claim has been approved. You can now find it in your personal space.',
          actionUrl: 'https://app.myclash.fr/me',
        });
      } else {
        await this.mail.sendNotification({
          to: email,
          subject: 'Demande de profil rejetée / Profile request rejected',
          title: 'Demande rejetée / Request rejected',
          body: reason
            ? `Votre demande de revendication de profil a été refusée : ${reason}. / Your profile claim request was rejected: ${reason}.`
            : 'Votre demande de revendication de profil a été refusée. / Your profile claim request was rejected.',
        });
      }
    } catch (err) {
      this.logger.warn(
        `claim-request notification failed for ${email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
