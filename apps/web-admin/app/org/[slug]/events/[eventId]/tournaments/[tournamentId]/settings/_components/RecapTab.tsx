'use client';

import { useEffect, useState } from 'react';
import { localeToBcp47 } from '@myclash/time';
import { Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

interface RecapContent {
  content: string;
  status: 'draft' | 'published';
  generatedAt: string;
  model: string | null;
}

const LOCALES = ['en', 'fr'] as const;
type Locale = (typeof LOCALES)[number];

/** Organizer control for the AI tournament recap: generate → review → publish. */
export function RecapTab({ tournamentId }: { tournamentId: string }) {
  const { locale: uiLocale, t } = useI18n();
  const apiUrl = getPublicApiUrl();
  const base = `${apiUrl}/api/v1/generated-content/tournament_recap/${tournamentId}`;

  const [locale, setLocale] = useState<Locale>('en');
  const [content, setContent] = useState<RecapContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}?locale=${locale}`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<RecapContent | null>) : null))
      .then((data) => {
        if (!cancelled) setContent(data);
      })
      .catch(() => {
        if (!cancelled) setContent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base, locale]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/generate?locale=${locale}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('organizer.recap.error'));
      setContent((await res.json()) as RecapContent);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('organizer.recap.error'));
    } finally {
      setBusy(false);
    }
  }

  async function setPublished(publish: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${publish ? 'publish' : 'unpublish'}?locale=${locale}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('organizer.recap.error'));
      setContent((await res.json()) as RecapContent);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('organizer.recap.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">
          {t('organizer.recap.title')}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{t('organizer.recap.subtitle')}</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-foreground-secondary">{t('organizer.recap.language')}</span>
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => {
              setLoading(true);
              setLocale(l);
            }}
            className={[
              'rounded-md border px-3 py-1 text-sm',
              locale === l
                ? 'border-accent bg-accent/10 text-foreground'
                : 'border-border text-foreground-secondary hover:border-muted',
            ].join(' ')}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : content ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <span
              className={[
                'rounded-full px-2 py-0.5 text-xs font-medium',
                content.status === 'published'
                  ? 'bg-success/10 text-success'
                  : 'bg-background text-muted',
              ].join(' ')}
            >
              {content.status === 'published'
                ? t('organizer.recap.published')
                : t('organizer.recap.draft')}
            </span>
            <span className="text-xs text-muted">
              {t('organizer.recap.generatedOn', {
                date: new Date(content.generatedAt).toLocaleDateString(localeToBcp47(uiLocale)),
              })}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground">{content.content}</p>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('organizer.recap.empty')}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void generate()}>
          {content ? t('organizer.recap.regenerate') : t('organizer.recap.generate')}
        </Button>
        {content && content.status !== 'published' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void setPublished(true)}
          >
            {t('organizer.recap.publish')}
          </Button>
        )}
        {content && content.status === 'published' && (
          <Button
            variant="cancel"
            size="sm"
            disabled={busy}
            onClick={() => void setPublished(false)}
          >
            {t('organizer.recap.unpublish')}
          </Button>
        )}
      </div>
    </div>
  );
}
