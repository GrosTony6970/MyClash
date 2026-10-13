'use client';

import { fetchMe } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { errorHome } from '@/lib/error-home';
import { firstRenewalHere } from '@/lib/renewed-here';
import { BackLink } from './BackLink';

/**
 * What a page of the public site shows for an address that leads nowhere: a
 * mistyped link, a wrong QR code, an Event or a bout that is not there (quick
 * win F13). It says so, and offers the way back.
 *
 * The way back is the one a failed page offers (`errorHome`). Under an Event
 * that is its home, and that home may be the very page that is missing, so the
 * list of Events is offered beside it: never a link to one more dead end alone.
 *
 * `renewLogin`: the server read this page with a login that ended and that the
 * browser can renew (`loginNeedsRenewal`). A club member's own draft Event is
 * "not found" for such a login. So the card first asks `/me`, the one route that
 * renews a login; when the login is back it loads the page again, once
 * (`firstRenewalHere`). Until `/me` answers it shows the spinner, not a "not
 * found" that may be false.
 */
export function NotFoundCard({ renewLogin }: { renewLogin: boolean }) {
  const { t } = useI18n();
  const { eventSlug } = useParams<{ eventSlug?: string }>();
  const path = usePathname();
  const home = errorHome(eventSlug, path);
  const [asking, setAsking] = useState(renewLogin);

  useEffect(() => {
    if (!renewLogin) return;
    let left = false;
    void fetchMe(getPublicApiUrl()).then((me) => {
      if (left) return;
      if (me.ok && me.data.type === 'claimed' && firstRenewalHere(path)) window.location.reload();
      else setAsking(false);
    });
    return () => {
      left = true;
    };
  }, [renewLogin, path]);

  if (asking) {
    return (
      <main id="main-content" className="flex min-h-[50vh] items-center justify-center">
        <span
          role="status"
          aria-label={t('common.loading')}
          className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-transparent"
        />
      </main>
    );
  }

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
