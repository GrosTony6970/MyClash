import Link from 'next/link';
import { passwordChangedKey, type PasswordChanged } from './security-requests';

/**
 * A password that was changed, said in place. With no login from the door the
 * browser's login is cleared (operator ruling 358): the sentence then leads to
 * the sign-in screen, as both reset pages do.
 */
export function PasswordChangedNotice({
  changed,
  t,
}: {
  changed: PasswordChanged;
  t: (key: string) => string;
}) {
  return (
    <p
      className="mt-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
      role="status"
    >
      {t(passwordChangedKey(changed))}
      {changed === 'sign_in_again' && (
        <>
          {' '}
          <Link href="/login" className="font-semibold underline">
            {t('publicApp.home.signIn')}
          </Link>
        </>
      )}
    </p>
  );
}
