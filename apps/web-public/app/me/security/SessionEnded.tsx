import Link from 'next/link';

/** The ended session, said in place: the form keeps what she typed (operator ruling 329). */
export function SessionEnded({ t }: { t: (key: string) => string }) {
  return (
    <p
      className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {t('publicApp.security.errors.sessionEnded')}{' '}
      <Link href="/login" className="font-semibold underline">
        {t('publicApp.security.errors.signInAgain')}
      </Link>
    </p>
  );
}
