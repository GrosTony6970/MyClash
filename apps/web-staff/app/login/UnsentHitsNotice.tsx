'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { totalPendingCount } from '../../src/offline/outbox';
import { unsentHitsMessage } from '../../src/lib/unsent-hits';

/**
 * The hits this tablet still holds, said on the sign-in screen (ruling 241).
 *
 * A tablet whose session has ended is sent here, and this screen has no sync
 * bar. Read from the tablet's own queue: nothing is sent, nobody is signed in.
 */
export function UnsentHitsNotice() {
  const { t } = useI18n();
  const [count, setCount] = useState(0);

  useEffect(() => {
    // A browser with no IndexedDB holds no queue: say nothing.
    void totalPendingCount().then(setCount, () => undefined);
  }, []);

  const message = unsentHitsMessage(count, t);
  if (!message) return null;
  return (
    <p
      role="status"
      data-testid="unsent-hits"
      className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
    >
      {message}
    </p>
  );
}
