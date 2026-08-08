import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { isFlagEnabledDirect } from '../../common/feature-flag-direct';
import { SupabaseService } from '../supabase/supabase.service';
import {
  broadcastHtml,
  emailChangeHtml,
  eventPassHtml,
  magicLinkHtml,
  notificationHtml,
  ownerWelcomeHtml,
} from './mail-templates';

export interface MagicLinkEmailOptions {
  to: string;
  magicLink: string;
  /** 'claim' = participant claiming their profile; 'login' = organizer login */
  type: 'claim' | 'login';
  /** Display name shown in the email body */
  displayName?: string;
}

export interface NotificationEmailOptions {
  to: string;
  subject: string;
  title: string;
  body: string;
  actionUrl?: string;
}

export interface BroadcastNotificationEmailOptions extends NotificationEmailOptions {
  severity: 'info' | 'warning' | 'alert';
}

export interface EmailChangeConfirmationOptions {
  to: string;
  oldEmail: string;
  newEmail: string;
  confirmUrl: string;
  expiresAt: string;
  displayName?: string;
}

export interface EventPassEmailOptions {
  to: string;
  displayName: string;
  eventName: string;
  passUrl: string;
}

export interface OwnerWelcomePasswordOptions {
  to: string;
  displayName: string;
  orgName: string;
  temporaryPassword: string;
  loginUrl: string;
  orgUrl: string;
}

/**
 * Outbound email: the transport, the kill-switch, and the error contract.
 *
 * The MARKUP lives in `./mail-templates.ts` — pure functions, no Nest, no
 * Resend. That split happened when the event pass pushed this file past the
 * 400-line budget, and it is a real seam rather than a line count: everything
 * here is about getting a message out (which client, from which address,
 * whether we are allowed to send at all, what happens when the provider says
 * no), and everything there is about what the message looks like.
 *
 * Every public method opens with `shouldSkip`, which honours the
 * `disable_email` flag. An outage flip must silence SMTP traffic WITHOUT
 * raising to callers — notification flows in particular do not expect `send()`
 * to throw on the kill-switch path.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly logoUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    const apiKey = config.getOrThrow<string>('RESEND_API_KEY');
    this.from = config.get<string>('MAIL_FROM', 'noreply@myclash.fr');
    // The logo lives in every Next app's `public/brand/` dir; we point at
    // the root domain in prod (`https://myclash.fr/brand/...`). Operators
    // can override via MAIL_LOGO_URL if they host the asset elsewhere
    // (e.g. a CDN) without redeploying the API code.
    const domain = config.get<string>('DOMAIN', 'myclash.fr');
    this.logoUrl = config.get<string>(
      'MAIL_LOGO_URL',
      `https://${domain}/brand/Logomini_nobackground.png`,
    );
    this.resend = new Resend(apiKey);
  }

  async sendMagicLink(opts: MagicLinkEmailOptions): Promise<void> {
    if (await this.shouldSkip('sendMagicLink')) return;
    const subject =
      opts.type === 'claim'
        ? 'Confirmez votre profil MyClash / Confirm your MyClash profile'
        : 'Votre lien de connexion MyClash / Your MyClash login link';
    await this.deliver('sendMagicLink', opts.to, subject, magicLinkHtml(this.logoUrl, opts));
  }

  async sendNotification(opts: NotificationEmailOptions): Promise<void> {
    if (await this.shouldSkip('sendNotification')) return;
    await this.deliver(
      'sendNotification',
      opts.to,
      opts.subject,
      notificationHtml(this.logoUrl, opts),
    );
  }

  async sendBroadcastNotification(opts: BroadcastNotificationEmailOptions): Promise<void> {
    if (await this.shouldSkip('sendBroadcastNotification')) return;
    await this.deliver(
      'sendBroadcastNotification',
      opts.to,
      opts.subject,
      broadcastHtml(this.logoUrl, opts),
    );
  }

  async sendEmailChangeConfirmation(opts: EmailChangeConfirmationOptions): Promise<void> {
    if (await this.shouldSkip('sendEmailChangeConfirmation')) return;
    await this.deliver(
      'sendEmailChangeConfirmation',
      opts.to,
      'Confirmer votre email MyClash / Confirm your MyClash email change',
      emailChangeHtml(this.logoUrl, opts),
    );
  }

  /**
   * A personal event pass, for a roster entry with no MyClash account.
   *
   * The link carries the raw token — the only copy that exists, since the
   * database holds a sha256 (migration 0176). Delivery failing here is
   * therefore a lost pass, not a retryable message: the caller records the
   * address so the organiser can chase it.
   */
  async sendEventPass(opts: EventPassEmailOptions): Promise<void> {
    if (await this.shouldSkip('sendEventPass')) return;
    await this.deliver(
      'sendEventPass',
      opts.to,
      `Votre pass ${opts.eventName} / Your ${opts.eventName} pass`,
      eventPassHtml(this.logoUrl, opts),
    );
  }

  async sendOwnerWelcomePassword(opts: OwnerWelcomePasswordOptions): Promise<void> {
    if (await this.shouldSkip('sendOwnerWelcomePassword')) return;
    await this.deliver(
      'sendOwnerWelcomePassword',
      opts.to,
      `Votre compte MyClash pour ${opts.orgName} / Your MyClash account for ${opts.orgName}`,
      ownerWelcomeHtml(this.logoUrl, opts),
    );
  }

  // ── transport ─────────────────────────────────────────────────────────────

  /**
   * Hand one message to Resend.
   *
   * The error contract every caller already relied on, now stated once: a
   * provider rejection is LOGGED with the provider's own payload and then
   * RETHROWN. Swallowing it here would make a bounced magic link or an
   * undelivered pass indistinguishable from a delivered one.
   */
  private async deliver(method: string, to: string, subject: string, html: string): Promise<void> {
    const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });

    if (error) {
      this.logger.error(`${method}: failed to send to ${to}: ${JSON.stringify(error)}`);
      throw new Error(`Mail delivery failed: ${error.message}`);
    }

    this.logger.log(`${method}: sent to ${to}`);
  }

  /**
   * Honour the `disable_email` kill-switch.
   *
   * Returns rather than throws, so flipping the flag during an outage silences
   * traffic without breaking flows that treat a send as fire-and-forget.
   */
  private async shouldSkip(method: string): Promise<boolean> {
    if (await isFlagEnabledDirect(this.supabase, 'disable_email')) {
      this.logger.log(`mail.skipped flag=disable_email method=${method}`);
      return true;
    }
    return false;
  }
}
