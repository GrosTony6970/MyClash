'use client';

import { useCallback, useEffect, useState } from 'react';
import { LEGAL_DOCUMENT_KINDS, type LegalDocumentKind } from '@myclash/types';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { currentLegalVersionFields, getLegalUrl } from '@/lib/legal-url';
import { SettingRow } from './controls';

interface AcceptanceSummary {
  kind: LegalDocumentKind;
  version: string;
  acceptedAt: string;
  current: boolean;
}

interface LegalStatus {
  accepted: AcceptanceSummary[];
  pending: LegalDocumentKind[];
}

type Status = 'loading' | 'ready' | 'error';

/**
 * "Your agreements" — what this account accepted and when, reading the same
 * `GET /api/v1/me/legal` the re-acceptance banner posts to, so the two views
 * cannot disagree about what is outstanding.
 *
 * Shows the version and the date, never the row id.
 */
export function LegalSection({ apiUrl }: { apiUrl: string }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<LegalStatus | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);

  // Inline rather than a `useCallback` the effect calls: the
  // `react-hooks/set-state-in-effect` rule (error, max-warnings 0) flags an
  // effect body that invokes a state-setting helper, and the promise-callback
  // shape below is the one the sibling sections already use.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/legal`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('load');
        setData((await res.json()) as LegalStatus);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [apiUrl]);

  /** Re-read after an accept, so the rows and the button agree immediately. */
  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/legal`, { credentials: 'include' });
      if (!res.ok) throw new Error('load');
      setData((await res.json()) as LegalStatus);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [apiUrl]);

  async function acceptCurrent() {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/legal`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentLegalVersionFields()),
      });
      // A 400 means this bundle is older than what is published — reloading is
      // the only honest fix, since we cannot accept text we did not display.
      if (!res.ok) {
        window.location.reload();
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function formatDate(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleDateString(localeToBcp47(locale), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('legal.settings.title')}
      </h2>
      <p className="mt-1 text-xs leading-5 text-muted">{t('legal.settings.description')}</p>

      {status === 'loading' && <p className="mt-4 text-sm text-muted">{t('common.loading')}</p>}
      {status === 'error' && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('publicApp.meSettings.privacy.loadError')}
        </p>
      )}

      {status === 'ready' && data && (
        <>
          <div className="mt-3 divide-y divide-border">
            {LEGAL_DOCUMENT_KINDS.map((kind) => {
              const row = data.accepted.find((entry) => entry.kind === kind);
              return (
                <SettingRow
                  key={kind}
                  label={kind === 'terms' ? t('legal.terms') : t('legal.privacy')}
                  description={
                    row
                      ? [
                          t('legal.settings.version', { version: row.version }),
                          t('legal.settings.acceptedOn', { date: formatDate(row.acceptedAt) }),
                          row.current ? '' : t('legal.settings.outdated'),
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : t('legal.settings.notAccepted')
                  }
                  control={
                    <a
                      href={getLegalUrl(kind, locale)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-accent underline-offset-2 hover:underline"
                    >
                      {t('actions.view')}
                    </a>
                  }
                />
              );
            })}
          </div>

          {data.pending.length > 0 && (
            <button
              type="button"
              onClick={() => void acceptCurrent()}
              disabled={busy}
              className="mt-4 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {busy ? t('legal.banner.accepting') : t('legal.settings.acceptCurrent')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
