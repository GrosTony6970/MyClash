'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { currentLegalVersionFields, getLegalUrl } from '../../src/lib/legal-url';

/**
 * Shown when a policy has been revised since this account last accepted one.
 *
 * A banner, not a wall. The alternative — an interstitial nobody can dismiss —
 * would lock a competitor out of their own schedule mid-event over a
 * sub-processor being added to the privacy policy. The account already exists
 * and already agreed to a prior version; what is outstanding is an update, and
 * it can wait until they are not standing on a piste.
 *
 * `pendingLegal` comes from `GET /api/v1/me`, which every surface already
 * calls, so this costs no extra round trip on the common (empty) path.
 */
export function LegalUpdateBanner() {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${getPublicApiUrl()}/api/v1/me`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as { pendingLegal?: string[] };
        if (!cancelled) setPending(body.pendingLegal ?? []);
      } catch {
        // A banner is not worth surfacing a network error for.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`${getPublicApiUrl()}/api/v1/me/legal`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentLegalVersionFields()),
      });
      if (!res.ok) {
        // 400 = this bundle is older than what is published. A reload is the
        // only honest fix: we cannot accept on behalf of text we did not show.
        window.location.reload();
        return;
      }
      const body = (await res.json()) as { pending?: string[] };
      setPending(body.pending ?? []);
    } catch {
      // Leave the banner up; the next page load asks again.
    } finally {
      setBusy(false);
    }
  }, []);

  if (dismissed || pending.length === 0) return null;

  return (
    <div
      role="status"
      className="border-b border-border bg-surface px-4 py-3 text-sm text-foreground"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center">
        <span className="font-semibold">{t('legal.banner.title')}</span>
        <span className="text-foreground-secondary">{t('legal.banner.body')}</span>
        <span className="flex items-center gap-3">
          <a
            href={getLegalUrl(pending[0] === 'privacy' ? 'privacy' : 'terms', locale)}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2"
          >
            {pending[0] === 'privacy' ? t('legal.privacy') : t('legal.terms')}
          </a>
          <button
            type="button"
            onClick={() => void accept()}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 font-semibold text-accent-foreground disabled:opacity-50"
          >
            {busy ? t('legal.banner.accepting') : t('legal.banner.review')}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-muted underline-offset-2 hover:underline"
          >
            {t('legal.banner.dismiss')}
          </button>
        </span>
      </div>
    </div>
  );
}
