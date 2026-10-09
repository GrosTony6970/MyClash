'use client';

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { ownedClubNoticeKey } from '@/lib/sign-in-failure';

const subscribeToNothing = () => () => {};
const onTheClient = () => window.location.search;
const onTheServer = () => '';

/**
 * Why an account that signed up again is on the page of a club it had: the
 * sign-up made no second one (operator ruling 369). The API's sign-up doors
 * send it here with the reason in the address.
 *
 * Reads `window.location` through `useSyncExternalStore`, so the server's
 * render (no notice) and the client's first render agree.
 */
export function OwnedClubNotice(): ReactNode {
  const { t } = useI18n();
  const search = useSyncExternalStore(subscribeToNothing, onTheClient, onTheServer);
  const key = ownedClubNoticeKey(search);
  if (!key) return null;
  return (
    <p
      role="status"
      className="mb-6 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
    >
      {t(key)}
    </p>
  );
}
