import { SIGNUP_REFUSED_PARAM } from '@myclash/types';
import { signupRefusedKey } from '../../src/lib/sign-in-failure';
import { AuthPage } from './AuthPage';

/**
 * A mailed sign-in link the API refused for the maintenance lockdown lands here with the
 * reason in the address (operator ruling 324), and the panel opens on that sentence.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <AuthPage
      initialTab="signin"
      refused={signupRefusedKey((await searchParams)[SIGNUP_REFUSED_PARAM])}
    />
  );
}
