/**
 * The HTML half of every outbound email — pure functions, no Nest and no Resend.
 *
 * Split out of `mail.service.ts` when adding the event pass pushed that file
 * past the 400-line budget. The seam is a real one rather than a line count:
 * what is left in the service is transport (the Resend client, the `from`
 * address, the `disable_email` kill-switch and the error handling), and what is
 * here is markup. Markup is also the part worth reading in a diff, and the part
 * a reviewer can reason about without a mock.
 *
 * Conventions that must hold for every template here:
 *   - INLINE styles only. Email clients discard <style> blocks and external CSS.
 *   - Bilingual FR/EN side by side. MailService takes no locale and giving it
 *     one is its own concern; until then, both languages ship in every message.
 *   - Every interpolated value goes through `escapeHtml`. These bodies carry
 *     user-supplied names, org names and event names.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Brand accent, matching `--color-accent`. Hard-coded because email cannot read a token. */
const ACCENT = '#b91c1c';

const BUTTON_STYLE = `background:${ACCENT};color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block`;

const FOOTER = `
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">MyClash - Plateforme libre pour les evenements HEMA</p>`;

/**
 * Shared header: a 40×40 logo next to the "MyClash" wordmark.
 *
 * The wordmark stays TEXT so image-blocking clients (Outlook desktop,
 * privacy-mode webmail) still see the brand.
 */
export function renderHeader(logoUrl: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px">
  <tr>
    <td style="vertical-align:middle;padding-right:12px">
      <img src="${escapeHtml(logoUrl)}" alt="MyClash" width="40" height="40" style="display:block;border:0;outline:none;text-decoration:none">
    </td>
    <td style="vertical-align:middle;font-family:sans-serif;font-size:24px;font-weight:bold;color:#1a1a1a">
      MyClash
    </td>
  </tr>
</table>`;
}

/** The document shell every template shares. */
function page(logoUrl: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  ${renderHeader(logoUrl)}
${body}
${FOOTER}
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `  <p style="margin:32px 0"><a href="${escapeHtml(url)}" style="${BUTTON_STYLE}">${label}</a></p>`;
}

export function magicLinkHtml(
  logoUrl: string,
  opts: { magicLink: string; type: 'claim' | 'login'; displayName?: string },
): string {
  const greeting = opts.displayName ? `Bonjour ${escapeHtml(opts.displayName)},` : 'Bonjour,';
  const intro =
    opts.type === 'claim'
      ? '<p>Cliquez sur le lien ci-dessous pour confirmer votre profil et acceder a votre planning.</p><p>Click the link below to confirm your profile and access your schedule.</p>'
      : '<p>Cliquez sur le lien ci-dessous pour vous connecter a MyClash.</p><p>Click the link below to log in to MyClash.</p>';
  const label =
    opts.type === 'claim' ? 'Confirmer mon profil / Confirm my profile' : 'Se connecter / Log in';

  return page(
    logoUrl,
    `  <p>${greeting}</p>
  ${intro}
${button(opts.magicLink, label)}
  <p style="color:#666;font-size:13px">Ce lien expire dans 1 heure. / This link expires in 1 hour.</p>
  <p style="color:#666;font-size:13px">Si vous n'avez pas demande ce lien, ignorez cet email. / If you didn't request this link, ignore this email.</p>`,
  );
}

export function notificationHtml(
  logoUrl: string,
  opts: { title: string; body: string; actionUrl?: string },
): string {
  return page(
    logoUrl,
    `  <h2 style="font-size:20px;margin-bottom:12px">${escapeHtml(opts.title)}</h2>
  <p>${escapeHtml(opts.body)}</p>
${opts.actionUrl ? button(opts.actionUrl, 'Ouvrir MyClash / Open MyClash') : ''}`,
  );
}

export function broadcastHtml(
  logoUrl: string,
  opts: { title: string; body: string; actionUrl?: string; severity: 'info' | 'warning' | 'alert' },
): string {
  const label =
    opts.severity === 'alert'
      ? 'Alerte / Alert'
      : opts.severity === 'warning'
        ? 'Attention / Warning'
        : 'Information / Info';
  const color =
    opts.severity === 'alert' ? '#dc2626' : opts.severity === 'warning' ? '#ca8a04' : '#16a34a';

  return page(
    logoUrl,
    `  <p style="display:inline-block;background:${color};color:#fff;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:bold">${label}</p>
  <h2 style="font-size:20px;margin-bottom:12px">${escapeHtml(opts.title)}</h2>
  <p>${escapeHtml(opts.body)}</p>
  <p style="color:#555;font-size:14px">Message envoye par l'organisation de votre evenement. / Message sent by your event organization.</p>
${opts.actionUrl ? button(opts.actionUrl, 'Ouvrir MyClash / Open MyClash') : ''}`,
  );
}

export function emailChangeHtml(
  logoUrl: string,
  opts: {
    oldEmail: string;
    newEmail: string;
    confirmUrl: string;
    expiresAt: string;
    displayName?: string;
  },
): string {
  const greeting = opts.displayName ? `Bonjour ${escapeHtml(opts.displayName)},` : 'Bonjour,';
  const oldEmail = escapeHtml(opts.oldEmail);
  const newEmail = escapeHtml(opts.newEmail);
  const expiresAt = escapeHtml(opts.expiresAt);

  return page(
    logoUrl,
    `  <p>${greeting}</p>
  <p>Vous avez demande a changer l email de votre compte MyClash de <strong>${oldEmail}</strong> vers <strong>${newEmail}</strong>.</p>
  <p>You requested to change your MyClash account email from <strong>${oldEmail}</strong> to <strong>${newEmail}</strong>.</p>
${button(opts.confirmUrl, 'Confirmer le changement / Confirm email change')}
  <p style="color:#666;font-size:13px">Ce lien expire a ${expiresAt}. / This link expires at ${expiresAt}.</p>
  <p style="color:#666;font-size:13px">Si vous n'avez pas demande ce changement, ignorez cet email. / If you did not request this change, ignore this email.</p>`,
  );
}

/**
 * A personal event pass.
 *
 * The link IS the credential — it carries the raw token, of which only a sha256
 * is stored (migration 0176). So it says so plainly rather than pretending to be
 * a notification: "do not forward this" is the entire security instruction, and
 * a recipient who does not understand what they are holding cannot follow it.
 *
 * The last line matters as much as the button. A pass that will not load in a
 * venue dead-zone is not a failure the fighter has to solve at the desk — name
 * search is the desk's primary path and always works.
 */
export function eventPassHtml(
  logoUrl: string,
  opts: { displayName: string; eventName: string; passUrl: string },
): string {
  const eventName = escapeHtml(opts.eventName);

  return page(
    logoUrl,
    `  <p>Bonjour ${escapeHtml(opts.displayName)},</p>
  <p>Voici votre pass personnel pour <strong>${eventName}</strong>. Ouvrez-le sur votre telephone et presentez le QR code a l accueil.</p>
  <p>Here is your personal pass for <strong>${eventName}</strong>. Open it on your phone and show the QR code at the check-in desk.</p>
${button(opts.passUrl, 'Ouvrir mon pass / Open my pass')}
  <p style="color:#666;font-size:13px">Ce lien est personnel : ne le transferez pas. / This link is personal - please do not forward it.</p>
  <p style="color:#666;font-size:13px">Pas de reseau sur place ? L accueil peut aussi vous trouver par votre nom. / No signal at the venue? The desk can also find you by name.</p>`,
  );
}

export function ownerWelcomeHtml(
  logoUrl: string,
  opts: {
    to: string;
    displayName: string;
    orgName: string;
    temporaryPassword: string;
    loginUrl: string;
    orgUrl: string;
  },
): string {
  const orgName = escapeHtml(opts.orgName);
  const orgUrl = escapeHtml(opts.orgUrl);

  return page(
    logoUrl,
    `  <p>Bonjour ${escapeHtml(opts.displayName)},</p>
  <p>Un compte MyClash a ete cree pour vous en tant qu organisateur de <strong>${orgName}</strong>.</p>
  <p>A MyClash account has been created for you as organizer of <strong>${orgName}</strong>.</p>
  <p style="margin:24px 0;padding:16px;background:#f8f8f8;border-radius:6px">
    <strong>Email :</strong> ${escapeHtml(opts.to)}<br>
    <strong>Mot de passe temporaire / Temporary password :</strong>
    <code style="font-family:monospace;background:#fff;padding:4px 8px;border-radius:4px;border:1px solid #ddd">${escapeHtml(opts.temporaryPassword)}</code>
  </p>
${button(opts.loginUrl, 'Se connecter / Log in')}
  <p style="color:#666;font-size:13px">
    Apres connexion, changez immediatement votre mot de passe dans vos parametres.<br>
    After logging in, change your password immediately in your settings.
  </p>
  <p style="color:#666;font-size:13px">
    Votre espace d organisation : <a href="${orgUrl}">${orgUrl}</a>
  </p>`,
  );
}
