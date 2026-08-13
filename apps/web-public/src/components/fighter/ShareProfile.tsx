'use client';

import { useState, useSyncExternalStore } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useI18n } from '@myclash/next-i18n/client';

// No-op store: we only need a client-vs-server snapshot, not live updates.
const subscribe = () => () => {};

/**
 * A small share card for a fighter's public profile: a QR code plus a
 * copy-link button. The absolute URL is built client-side from
 * `window.location.origin` (via useSyncExternalStore, so it's hydration-safe and
 * needs no configured base URL). Renders nothing during SSR / before hydration.
 */
export function ShareProfile({ slug }: { slug: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const url = useSyncExternalStore(
    subscribe,
    () => (slug ? `${window.location.origin}/fighters/${slug}` : ''),
    () => '',
  );

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — no-op.
    }
  };

  if (!url) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
      {/* QR stays dark-on-white for scannability regardless of page theme. */}
      <div className="shrink-0 rounded bg-white p-1.5">
        <QRCodeSVG value={url} size={72} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">
          {t('publicApp.fighterProfile.shareProfile')}
        </p>
        <p className="mt-0.5 text-xs text-muted">{t('publicApp.fighterProfile.scanQr')}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="mt-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-background"
        >
          {copied ? t('publicApp.fighterProfile.copied') : t('publicApp.fighterProfile.copyLink')}
        </button>
      </div>
    </div>
  );
}
