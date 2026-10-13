'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
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
 */
export function ShareButton({ path }: { path: string }) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const underWay = useRef(false);
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(hide.current), []);

  const share = async () => {
    if (underWay.current) return;
    underWay.current = true;
    clearTimeout(hide.current);
    const did = await shareLink(window.location.origin + path, document.title, navigator);
    underWay.current = false;
    setOutcome(did);
    if (did === 'copied' || did === 'failed') {
      hide.current = setTimeout(() => setOutcome(null), SHOWS_MS[did]);
    }
  };

  const messageKey = shareMessageKey(outcome);

  return (
    <>
      <button
        type="button"
        data-testid="share-button"
        onClick={() => void share()}
        className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm font-semibold text-foreground-secondary transition-colors hover:border-muted hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t(messageKey ?? 'publicApp.share.share')}
      </button>
      <span role="status" data-testid="share-status" className="sr-only">
        {messageKey ? t(messageKey) : ''}
      </span>
    </>
  );
}
