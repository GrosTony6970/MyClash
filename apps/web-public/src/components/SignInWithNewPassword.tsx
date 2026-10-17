import Link from 'next/link';
import { Button } from '@myclash/ui';
import { PasswordPanel } from './PasswordPanel';

/**
 * The end of a password written from a mailed link that handed no login (operator ruling
 * 358): the reset page, and "choose your password". The password is written, and she signs
 * in with it. The door could not sign her in itself: the auth server gave no login, or this
 * browser held another account's.
 */
export function SignInWithNewPassword({
  t,
  title,
  message,
}: {
  t: (key: string) => string;
  title: string;
  message: string;
}) {
  return (
    <PasswordPanel title={title}>
      <p className="mt-2 text-sm leading-6 text-muted" role="status">
        {message}
      </p>
      <Button asChild variant="primary" className="mt-5 w-full py-3">
        <Link href="/login">{t('publicApp.home.signIn')}</Link>
      </Button>
    </PasswordPanel>
  );
}
