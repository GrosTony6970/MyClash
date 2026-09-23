'use client';

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { claimRefusalMessageKey } from '@/lib/claim-refusal';

const subscribeToNothing = () => () => {};
const onTheClient = () => window.location.search;
const onTheServer = () => '';

/**
 * Why the emailed claim link just used did not claim its roster row (ruling 57).
 * The API signs the reader in and sends them to the claim page, or to /me when
 * there was no row to name an Event by, with the reason in the query.
 *
 * Reads `window.location` rather than `useSearchParams`, which the repo's React
 * Compiler setup bails out on, through `useSyncExternalStore` so the server's
 * render (no notice) and the client's first render agree.
 */
export function ClaimRefusedNotice({ className = '' }: { className?: string }): ReactNode {
  const { t } = useI18n();
  const search = useSyncExternalStore(subscribeToNothing, onTheClient, onTheServer);
  const key = claimRefusalMessageKey(search);
  if (!key) return null;
  return (
    <p
      role="alert"
      className={`rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm font-semibold text-danger ${className}`}
    >
      {t(key)}
    </p>
  );
}
