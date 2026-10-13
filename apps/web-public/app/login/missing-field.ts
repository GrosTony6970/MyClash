/**
 * The first field the participant sign-in form still needs before it can be
 * sent, or null. The email comes first: every action of the page needs it. Only
 * the two password actions (sign in, create an account) need a password.
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
