/**
 * The link a mail carries (operator ruling 303): one of our own doors, with the
 * one-time code GoTrue made as `?token_hash=`. The door spends the code itself
 * (`verifyOtp`).
 *
 * GoTrue's own `action_link` is never mailed. On our stack it points at
 * `/verify` on the public site, which nothing serves (GoTrue lives under
 * `/auth/v1`). Behind it GoTrue would spend the code itself and hand the
 * session over after a `#`, which no door of ours can read.
 *
 * No code, no link: the sender mails nothing.
 */
export function mailedLink(
  door: string,
  properties: { hashed_token?: string } | null | undefined,
): string | null {
  const code = properties?.hashed_token;
  if (!code) return null;
  return `${door}${door.includes('?') ? '&' : '?'}token_hash=${encodeURIComponent(code)}`;
}

/**
 * The sign-in door (`GET /auth/callback`): it signs the reader in, then sends
 * her to `next` on the host that `type` names. A claim names its roster row.
 */
export function signInDoor(domain: string, type: string, next: string, personId?: string): string {
  const claimed = personId ? `&personId=${personId}` : '';
  return `https://api.${domain}/api/v1/auth/callback?type=${type}${claimed}&next=${encodeURIComponent(next)}`;
}
