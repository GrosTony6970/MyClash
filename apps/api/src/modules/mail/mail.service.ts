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

    const greeting = opts.displayName ? `Bonjour ${opts.displayName},` : 'Bonjour,';

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">MyClash</h1>
  <p>${greeting}</p>
  ${
    opts.type === 'claim'
      ? '<p>Cliquez sur le lien ci-dessous pour confirmer votre profil et accéder à votre planning.</p><p>Click the link below to confirm your profile and access your schedule.</p>'
      : '<p>Cliquez sur le lien ci-dessous pour vous connecter à MyClash.</p><p>Click the link below to log in to MyClash.</p>'
  }
  <p style="margin:32px 0">
    <a href="${opts.magicLink}"
       style="background:#c0392b;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
      ${opts.type === 'claim' ? 'Confirmer mon profil / Confirm my profile' : 'Se connecter / Log in'}
    </a>
  </p>
  <p style="color:#666;font-size:13px">Ce lien expire dans 1 heure. / This link expires in 1 hour.</p>
  <p style="color:#666;font-size:13px">Si vous n'avez pas demandé ce lien, ignorez cet email. / If you didn't request this link, ignore this email.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">MyClash — Plateforme libre pour les événements HEMA</p>
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
}
