import { SIGNUP_REFUSED_PARAM } from '@myclash/types';
import { signupRefusedKey } from '../../src/lib/sign-in-failure';
import { AuthPage } from '../login/AuthPage';

/**
 * Signing up is a tab of the login panel, not a separate design. This route
 * stays because it is linked from the marketing site and from mail we have
 * already sent — it just opens the panel on the other tab.
 *
 * A mailed sign-up link the API refused lands here with the reason in the
 * address (operator ruling 305), and the panel opens on that sentence.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <AuthPage
      initialTab="signup"
      refused={signupRefusedKey((await searchParams)[SIGNUP_REFUSED_PARAM])}
    />
  );
}
