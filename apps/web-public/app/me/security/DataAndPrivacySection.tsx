'use client';

/**
 * DataAndPrivacySection — the subject's own data rights on /me/security.
 *
 * Two jobs:
 *  1. Download everything MyClash holds about you (GDPR Art. 15 / 20).
 *  2. Say honestly what deleting the account does AND does not remove. Results
 *     keep the competitor's name as a public record, and a user is entitled to
 *     know that before they press delete rather than after (Art. 13/14).
 *
 * Extracted rather than added inline: page.tsx is already 400+ lines and the
 * file/function caps are worth keeping green instead of baselining.
 */

import { useState } from 'react';
import { Button } from '@myclash/ui';

export function DataAndPrivacySection({
  apiUrl,
  t,
}: {
  apiUrl: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fetchAndSaveExport(apiUrl);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        window.location.replace('/login');
        return;
      }
      setError(t('publicApp.security.dataError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('publicApp.security.dataTitle')}
      </h2>
      <p className="mt-2 text-sm text-muted">{t('publicApp.security.dataSubtitle')}</p>

      <Button type="button" onClick={() => void download()} disabled={busy} className="mt-3">
        {busy ? t('publicApp.security.dataDownloading') : t('publicApp.security.dataDownload')}
      </Button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <RetentionNote t={t} />
    </section>
  );
}

/** What deleting the account does and does not remove — Art. 13/14 transparency. */
function RetentionNote({ t }: { t: (key: string) => string }) {
  return (
    <div className="mt-4 rounded-md border border-border bg-background p-4">
      <p className="text-sm font-semibold text-foreground">
        {t('publicApp.security.dataRetentionTitle')}
      </p>
      <p className="mt-2 text-sm text-muted">{t('publicApp.security.dataRetentionBody')}</p>
    </div>
  );
}

class UnauthorizedError extends Error {}

/**
 * Fetch the bundle and hand it to the browser as a download.
 *
 * fetch + blob rather than a plain `<a href>`: the cookie is cross-origin to the
 * API host, and this way a 401 or 500 surfaces as an error message instead of
 * navigating the user to a broken page.
 */
async function fetchAndSaveExport(apiUrl: string): Promise<void> {
  const res = await fetch(`${apiUrl}/api/v1/me/data-export.zip`, { credentials: 'include' });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error('export');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filenameFrom(res.headers.get('Content-Disposition'));
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the click to have been handed off.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Falls back to a sane name when the header is missing or unparseable. */
function filenameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^";]+)"?/);
  return match?.[1] ?? 'myclash-data-export.zip';
}
