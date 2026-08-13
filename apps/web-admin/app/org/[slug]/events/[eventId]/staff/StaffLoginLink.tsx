'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useI18n } from '@myclash/next-i18n/client';

interface Props {
  /** What this URL is for — rendered above the URL, so a row is never a bare link. */
  label: string;
  url: string;
  /** Optional sentence under the label. */
  description?: string;
  /**
   * Show a QR alongside. Only the sign-in links carry one: a referee scans it
   * from the tablet they are about to score on, which is the whole point.
   */
  withQr?: boolean;
}

/**
 * One shareable URL: its label, the URL itself, a copy button, and — for the
 * staff sign-in links — a QR code to scan from a tablet.
 *
 * Replaces the bare list of display URLs that gave no clue which Lice each one
 * belonged to.
 */
export function StaffLoginLink({ label, url, description, withQr = false }: Props) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (permissions / insecure context) — the URL is on
      // screen and selectable, so there is nothing to recover from.
    }
  }

  return (
    <div className="flex items-start gap-3 rounded border border-border bg-background px-3 py-2">
      {withQr && (
        // Dark-on-white regardless of theme, or a phone camera won't read it.
        <div className="shrink-0 rounded bg-white p-1.5">
          <QRCodeSVG value={url} size={80} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="truncate text-sm text-foreground-secondary">{url}</span>
          <button
            type="button"
            onClick={() => void copy()}
            className="shrink-0 text-sm font-semibold text-accent"
          >
            {copied ? t('organizer.staff.copied') : t('organizer.staff.copyUrl')}
          </button>
        </div>
        {withQr && <p className="mt-1 text-xs text-muted">{t('organizer.staff.scanQr')}</p>}
      </div>
    </div>
  );
}
