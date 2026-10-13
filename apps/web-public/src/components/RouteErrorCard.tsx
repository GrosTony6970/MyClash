'use client';

import { useI18n } from '@myclash/next-i18n/client';
import * as Sentry from '@sentry/nextjs';
import { useParams, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { errorHome } from '@/lib/error-home';
import { BackLink } from './BackLink';

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * The card a page of the public site shows when it failed: the ONE body of the
 * three segment error pages (the Event's pages, a bout's page, the personal
 * space). Without a segment error page an uncaught server error is the default
 * Next crash screen; with one, the failure stays inside the page's shell.
 *
 * It offers the retry AND a way home: when the second try fails too, "Try
 * again" alone was a dead end (quick win F14).
 */
export function RouteErrorCard({ error, reset }: RouteErrorProps) {
  const { t } = useI18n();
  const { eventSlug } = useParams<{ eventSlug?: string }>();
  const path = usePathname();
  const home = errorHome(eventSlug, path);

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main role="alert" className="mx-auto max-w-lg px-4 py-12 text-center">
      <h1 className="text-lg font-semibold text-foreground">{t('common.error')}</h1>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
        >
          {t('offline.tryAgain')}
        </button>
        <BackLink href={home.href} label={t(home.labelKey)} />
      </div>
    </main>
  );
}
