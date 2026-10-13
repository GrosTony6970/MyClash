'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useParams, usePathname } from 'next/navigation';
import { errorHome } from '@/lib/error-home';
import { BackLink } from './BackLink';

/**
 * What a page of the public site shows for an address that leads nowhere: a
 * mistyped link, a wrong QR code, an Event or a bout that is not there (quick
 * win F13). It says so, and offers the way back.
 *
 * The way back is the one a failed page offers (`errorHome`). Under an Event
 * that is its home, and that home may be the very page that is missing, so the
 * list of Events is offered beside it: never a link to one more dead end alone.
 */
export function NotFoundCard() {
  const { t } = useI18n();
  const { eventSlug } = useParams<{ eventSlug?: string }>();
  const home = errorHome(eventSlug, usePathname());

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-lg px-4 py-12 text-center">
      <h1 className="text-lg font-semibold text-foreground">{t('publicApp.notFound.title')}</h1>
      <p className="mt-2 text-sm text-foreground-secondary">{t('publicApp.notFound.body')}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <BackLink href={home.href} label={t(home.labelKey)} />
        {home.href !== '/' && <BackLink href="/" label={t('publicApp.login.backToEvents')} />}
      </div>
    </main>
  );
}
