'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { Button } from '@myclash/ui';
import { shareLink, shareMessageKey, type ShareOutcome } from '@/lib/share-link';

/** How long the button shows what happened. A failed copy stays longer: it must be read. */
const SHOWS_MS = { copied: 2000, failed: 6000 } as const;

/**
 * The Share button of a public page (quick win F19). `path` is the page's plain
 * address on this site: the address in the bar may carry `?return=…`, which is
 * the sender's way back, not the receiver's.
 *
 * The button shows what happened, then reads "Share" again; the same words go
 * to a polite live region for a screen reader. What a tap does is `shareLink`.
 *
 * The race: a tap while the share sheet is open. The browser refuses a second
 * sheet, and not as "closed by the person", so that refusal would copy the link
 * and say "Copied!" under the sheet. A tap is ignored until the one before it
 * has its answer.
 *
 * The timer that ends a message belongs to the effect, not to the tap: React
 * may clean an effect up and set it up again while the button stays (Strict
 * Mode as the page wakes up, a hidden `<Activity>` shown again), and a timer
 * the tap started would be lost, leaving "Copied!" for good.
 */
export function ShareButton({ path }: { path: string }) {
  const { t } = useI18n();
  // A new object per tap: a second tap starts the message's time again.
  const [shown, setShown] = useState<{ outcome: ShareOutcome } | null>(null);
  const underWay = useRef(false);

  useEffect(() => {
    const outcome = shown?.outcome;
    if (outcome !== 'copied' && outcome !== 'failed') return;
    const hide = setTimeout(() => setShown(null), SHOWS_MS[outcome]);
    return () => clearTimeout(hide);
  }, [shown]);

  const share = async () => {
    if (underWay.current) return;
    underWay.current = true;
    const outcome = await shareLink(window.location.origin + path, document.title, navigator);
    underWay.current = false;
    setShown({ outcome });
  };

  const messageKey = shareMessageKey(shown?.outcome ?? null);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        data-testid="share-button"
        onClick={() => void share()}
        className="min-h-11 shrink-0"
      >
        {t(messageKey ?? 'publicApp.share.share')}
      </Button>
      <span role="status" data-testid="share-status" className="sr-only">
        {messageKey ? t(messageKey) : ''}
      </span>
    </>
  );
}
