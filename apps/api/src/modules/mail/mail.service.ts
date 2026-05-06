import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.getOrThrow<string>('RESEND_API_KEY');
    this.from = config.get<string>('MAIL_FROM', 'noreply@myclash.fr');
    this.resend = new Resend(apiKey);
  }

  async sendMagicLink(opts: MagicLinkEmailOptions): Promise<void> {
    const subject =
      opts.type === 'claim'
        ? 'Confirmez votre profil MyClash / Confirm your MyClash profile'
        : 'Votre lien de connexion MyClash / Your MyClash login link';

    const greeting = opts.displayName ? `Bonjour ${escapeHtml(opts.displayName)},` : 'Bonjour,';
    const intro =
      opts.type === 'claim'
        ? '<p>Cliquez sur le lien ci-dessous pour confirmer votre profil et acceder a votre planning.</p><p>Click the link below to confirm your profile and access your schedule.</p>'
        : '<p>Cliquez sur le lien ci-dessous pour vous connecter a MyClash.</p><p>Click the link below to log in to MyClash.</p>';

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">MyClash</h1>
  <p>${greeting}</p>
  ${intro}
  <p style="margin:32px 0">
    <a href="${escapeHtml(opts.magicLink)}"
       style="background:#c0392b;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      ${opts.type === 'claim' ? 'Confirmer mon profil / Confirm my profile' : 'Se connecter / Log in'}
    </a>
  </p>
  <p style="color:#666;font-size:13px">Ce lien expire dans 1 heure. / This link expires in 1 hour.</p>
  <p style="color:#666;font-size:13px">Si vous n'avez pas demande ce lien, ignorez cet email. / If you didn't request this link, ignore this email.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">MyClash - Plateforme libre pour les evenements HEMA</p>
</body>
</html>`;

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: opts.to,
      subject,
      html,
    });

    if (error) {
      this.logger.error(`Failed to send magic link email to ${opts.to}: ${JSON.stringify(error)}`);
      throw new Error(`Mail delivery failed: ${error.message}`);
    }

    this.logger.log(`Magic link email (${opts.type}) sent to ${opts.to}`);
  }

  async sendNotification(opts: NotificationEmailOptions): Promise<void> {
    const html = this.renderBasicNotification(opts);
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      html,
    });

    if (error) {
      this.logger.error(
        `Failed to send notification email to ${opts.to}: ${JSON.stringify(error)}`,
      );
      throw new Error(`Mail delivery failed: ${error.message}`);
    }

    this.logger.log(`Notification email sent to ${opts.to}`);
  }

  async sendBroadcastNotification(opts: BroadcastNotificationEmailOptions): Promise<void> {
    const severityLabel =
      opts.severity === 'alert'
        ? 'Alerte / Alert'
        : opts.severity === 'warning'
          ? 'Attention / Warning'
          : 'Information / Info';
    const severityColor =
      opts.severity === 'alert' ? '#dc2626' : opts.severity === 'warning' ? '#ca8a04' : '#16a34a';
    const title = escapeHtml(opts.title);
    const body = escapeHtml(opts.body);
    const actionUrl = opts.actionUrl ? escapeHtml(opts.actionUrl) : null;

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">MyClash</h1>
  <p style="display:inline-block;background:${severityColor};color:#fff;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:bold">${severityLabel}</p>
  <h2 style="font-size:20px;margin-bottom:12px">${title}</h2>
  <p>${body}</p>
  <p style="color:#555;font-size:14px">Message envoye par l'organisation de votre evenement. / Message sent by your event organization.</p>
  ${
    actionUrl
      ? `<p style="margin:32px 0"><a href="${actionUrl}" style="background:#c0392b;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Ouvrir MyClash / Open MyClash</a></p>`
      : ''
  }
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">MyClash - Plateforme libre pour les evenements HEMA</p>
</body>
</html>`;

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      html,
    });

    if (error) {
      this.logger.error(`Failed to send broadcast email to ${opts.to}: ${JSON.stringify(error)}`);
      throw new Error(`Mail delivery failed: ${error.message}`);
    }

    this.logger.log(`Broadcast notification email sent to ${opts.to}`);
  }

  async sendEmailChangeConfirmation(opts: EmailChangeConfirmationOptions): Promise<void> {
    const displayName = opts.displayName ? escapeHtml(opts.displayName) : null;
    const oldEmail = escapeHtml(opts.oldEmail);
    const newEmail = escapeHtml(opts.newEmail);
    const confirmUrl = escapeHtml(opts.confirmUrl);
    const expiresAt = escapeHtml(opts.expiresAt);
    const greeting = displayName ? `Bonjour ${displayName},` : 'Bonjour,';

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">MyClash</h1>
  <p>${greeting}</p>
  <p>Vous avez demande a changer l email de votre compte MyClash de <strong>${oldEmail}</strong> vers <strong>${newEmail}</strong>.</p>
  <p>You requested to change your MyClash account email from <strong>${oldEmail}</strong> to <strong>${newEmail}</strong>.</p>
  <p style="margin:32px 0">
    <a href="${confirmUrl}"
       style="background:#c0392b;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      Confirmer le changement / Confirm email change
    </a>
  </p>
  <p style="color:#666;font-size:13px">Ce lien expire a ${expiresAt}. / This link expires at ${expiresAt}.</p>
  <p style="color:#666;font-size:13px">Si vous n'avez pas demande ce changement, ignorez cet email. / If you did not request this change, ignore this email.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">MyClash - Plateforme libre pour les evenements HEMA</p>
</body>
</html>`;

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: opts.to,
      subject: 'Confirmer votre email MyClash / Confirm your MyClash email change',
      html,
    });

    if (error) {
      this.logger.error(
        `Failed to send email-change confirmation to ${opts.to}: ${JSON.stringify(error)}`,
      );
      throw new Error(`Mail delivery failed: ${error.message}`);
    }

    this.logger.log(`Email-change confirmation sent to ${opts.to}`);
  }

  private renderBasicNotification(opts: NotificationEmailOptions): string {
    const title = escapeHtml(opts.title);
    const body = escapeHtml(opts.body);
    const actionUrl = opts.actionUrl ? escapeHtml(opts.actionUrl) : null;
    return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">MyClash</h1>
  <h2 style="font-size:20px;margin-bottom:12px">${title}</h2>
  <p>${body}</p>
  ${
    actionUrl
      ? `<p style="margin:32px 0"><a href="${actionUrl}" style="background:#c0392b;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Ouvrir MyClash / Open MyClash</a></p>`
      : ''
  }
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">MyClash - Plateforme libre pour les evenements HEMA</p>
</body>
</html>`;
  }
}
