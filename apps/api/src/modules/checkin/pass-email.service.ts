import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { insertAuditLog } from '../../common/audit-log';
import { MailService } from '../mail/mail.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PassService } from './pass.service';

/** Result of one mail-out, as the organiser's button reports it. */
export interface PassMailOutResult {
  sent: number;
  /** Already held a pass, and `resend` was not asked for. */
  skipped: number;
  /** Had an address but the send failed. Named so the organiser can chase them. */
  failed: string[];
  /** On the roster with no address at all — the desk finds these by name. */
  withoutEmail: number;
}

/**
 * How many sends run at once.
 *
 * Sequential would take a minute for a 300-person roster and time the request
 * out; unbounded `Promise.all` would open 300 concurrent connections to Resend
 * and collect rate-limit rejections that look exactly like delivery failures.
 * Ten is fast enough (a few seconds for a large event) and polite.
 */
const SEND_CONCURRENCY = 10;

/**
 * Mail event passes to the roster entries that cannot reach one themselves.
 *
 * The self-service pass needs an identity — a claimed account or a guest session
 * on the fighter's own device. A roster entry that was imported from a CSV and
 * never claimed has neither, and its holder may not know MyClash exists. If they
 * have an address on file, the pass can come to them instead.
 *
 * Its own service rather than more of `PassService`, which owns the secret and
 * is deliberately small. This owns a batch job: who qualifies, what happens when
 * one send fails, and what the organiser is told afterwards.
 */
@Injectable()
export class PassEmailService {
  private readonly logger = new Logger(PassEmailService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly pass: PassService,
    private readonly mail: MailService,
    private readonly orgs: OrganizationsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issue and mail a pass to every unclaimed roster entry with an address.
   *
   * `resend: false` (the default) SKIPS anyone who already holds a pass, and
   * that default is load-bearing. Issuing replaces the previous token, so a
   * second mail-out after adding three fighters on the Friday would otherwise
   * kill the link every one of Thursday's recipients is already holding.
   */
  async mailPasses(eventId: string, userId: string, resend: boolean): Promise<PassMailOutResult> {
    await this.assertCanMail(eventId, userId);

    const roster = await this.unclaimedRoster(eventId);
    const withoutEmail = roster.filter((person) => !person.email).length;
    const existing = resend ? new Set<string>() : await this.personsWithPass(eventId);

    const targets = roster.filter((person) => person.email && !existing.has(person.id));
    const result = await this.sendAll(eventId, targets);

    await insertAuditLog(this.supabase.service, {
      actorUserId: userId,
      action: 'event.passes_mailed',
      entityType: 'event',
      entityId: eventId,
      payload: { sent: result.sent, failed: result.failed.length, resend },
    });

    return {
      ...result,
      skipped: roster.filter((person) => person.email).length - targets.length,
      withoutEmail,
    };
  }

  // ── steps ────────────────────────────────────────────────────────────────

  private async assertCanMail(eventId: string, userId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const orgId = (data as { organization_id: string } | null)?.organization_id;
    if (!orgId) throw new BadRequestException('Event not found');
    // Mailing a credential to the whole roster is an organiser act, not an
    // event-day one. Editor is the same bar as editing the roster it targets.
    await this.orgs.assertOrgRole(orgId, userId, 'editor');
  }

  /**
   * Roster entries that cannot get a pass on their own.
   *
   * `claimed_by_user_id IS NULL` is the whole filter: a claimed fighter opens
   * `/e/<slug>/pass` and issues their own, and mailing them one would retire the
   * token their phone is already holding.
   */
  private async unclaimedRoster(
    eventId: string,
  ): Promise<Array<{ id: string; given_name: string; email: string | null }>> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id,given_name,family_name,email,claimed_by_user_id')
      .eq('event_id', eventId)
      .is('claimed_by_user_id', null);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{ id: string; given_name: string; email: string | null }>;
  }

  private async personsWithPass(eventId: string): Promise<Set<string>> {
    const { data, error } = await this.supabase.service
      .from('event_passes')
      .select('person_id')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return new Set(((data ?? []) as Array<{ person_id: string }>).map((row) => row.person_id));
  }

  private async sendAll(
    eventId: string,
    targets: Array<{ id: string; given_name: string; email: string | null }>,
  ): Promise<{ sent: number; failed: string[] }> {
    const event = await this.eventForEmail(eventId);
    let sent = 0;
    const failed: string[] = [];

    for (let start = 0; start < targets.length; start += SEND_CONCURRENCY) {
      const batch = targets.slice(start, start + SEND_CONCURRENCY);
      await Promise.all(
        batch.map(async (person) => {
          try {
            const issued = await this.pass.issue(eventId, person.id, 'email');
            await this.mail.sendEventPass({
              to: person.email as string,
              displayName: person.given_name,
              eventName: event.name,
              passUrl: this.passUrl(event.slug, issued.token),
            });
            sent += 1;
          } catch (err) {
            // One bad address must not abandon the rest of the roster. The
            // organiser gets the list back and can chase them individually.
            this.logger.error(`event pass mail failed for ${person.id}: ${(err as Error).message}`);
            failed.push(person.email as string);
          }
        }),
      );
    }

    return { sent, failed };
  }

  private async eventForEmail(eventId: string): Promise<{ name: string; slug: string }> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('name,slug')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const event = data as { name: string; slug: string } | null;
    if (!event) throw new BadRequestException('Event not found');
    return event;
  }

  /**
   * Where the emailed link lands.
   *
   * `app.${DOMAIN}` — the public app — because the page that renders the QR
   * lives in web-public and serves guests as well as claimed accounts. Derived
   * from DOMAIN rather than a new env key, the same shape every other outbound
   * link in this API uses (`auth.service.ts` reset-password,
   * `person-email-change.service.ts` confirm), so a rename cannot leave this one
   * pointing somewhere stale.
   */
  private passUrl(eventSlug: string, token: string): string {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    return `https://app.${domain}/e/${eventSlug}/pass?t=${encodeURIComponent(token)}`;
  }
}
