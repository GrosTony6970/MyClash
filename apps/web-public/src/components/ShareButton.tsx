'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { shareLink, shareMessageKey, type ShareOutcome } from '@/lib/share-link';

/** How long "Copied!" stays on the button. A failed copy stays until the next tap. */
const COPIED_SHOWS_MS = 2000;

/**
 * The Share button of a public page (quick win F19). `path` is the page's plain
 * address on this site: the address in the bar may carry `?return=…`, which is
 * the sender's way back, not the receiver's.
 *
 * The button shows what happened, so nothing moves on the page; the same words
 * go to a polite live region for a screen reader. What a tap does is
 * `shareLink`.
 */
export function ShareButton({ path }: { path: string }) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(hide.current), []);

  const share = async () => {
    clearTimeout(hide.current);
    const did = await shareLink(window.location.origin + path, document.title, navigator);
    setOutcome(did);
    if (did === 'copied') hide.current = setTimeout(() => setOutcome(null), COPIED_SHOWS_MS);
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
