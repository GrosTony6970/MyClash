import Link from 'next/link';
import { Button } from '@myclash/ui';

/**
 * The end of a reset that handed no login (operator ruling 358): the password is
 * written, and she signs in with it. The door could not sign her in itself: the
 * auth server gave no login, or this browser held another account's.
 */
export function SignInWithNewPassword({ t }: { t: (key: string) => string }) {
  return (
    <main
      data-theme="dark"
      data-accent="personal"
      className="min-h-screen bg-background px-4 py-10 text-foreground"
    >
      <div className="mx-auto max-w-md rounded-lg border border-border bg-surface p-8 shadow-2xl">
        <h1 className="text-2xl font-black">{t('publicApp.resetPassword.title')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted" role="status">
          {t('publicApp.resetPassword.doneSignIn')}
        </p>
        <Button asChild variant="primary" className="mt-5 w-full py-3">
          <Link href="/login">{t('publicApp.home.signIn')}</Link>
        </Button>
      </div>
    </main>
  );
}
