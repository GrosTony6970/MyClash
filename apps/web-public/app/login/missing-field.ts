/**
 * The first field the participant sign-in form still needs before it can be
 * sent, or null. The email comes first: every action of the page needs it. Only
 * the password sign-in needs a password: a sign-up chooses it on the page its mail opens.
 *
 * The page used to return in silence over an empty field: a button pressed, and
 * nothing said (quick win F12).
 */
export function missingField(
  email: string,
  password: string,
  needsPassword: boolean,
): 'email' | 'password' | null {
  if (!email.trim()) return 'email';
  return needsPassword && !password ? 'password' : null;
}
