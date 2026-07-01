'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface Insight {
  content: string;
  status: 'draft' | 'published';
  generatedAt: string;
}

/**
 * The fighter's own AI performance insight (BYOK). Runs on their own key via
 * /me/insight (identity resolved server-side). Generate → review → publish to
 * the public profile. Shows a "configure your key" CTA when none is set.
 */
export function InsightCard({ apiUrl }: { apiUrl: string }) {
  const { t, locale } = useI18n();
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/insight?locale=${locale}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<Insight | null>) : null))
      .then((d) => setInsight(d))
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [apiUrl, locale]);

  async function generate() {
    setBusy(true);
    setError(null);
    setNeedsKey(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/insight/generate?locale=${locale}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 404) {
        setNeedsKey(true);
        return;
      }
      if (!res.ok) throw new Error(t('publicApp.meInsight.error'));
      setInsight((await res.json()) as Insight);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('publicApp.meInsight.error'));
    } finally {
      setBusy(false);
    }
  }

  async function setPublished(publish: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/me/insight/${publish ? 'publish' : 'unpublish'}?locale=${locale}`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('publicApp.meInsight.error'));
      setInsight((await res.json()) as Insight);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('publicApp.meInsight.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {t('publicApp.meInsight.title')}
        </h2>
        {insight && (
          <span
            className={[
              'rounded-full px-2 py-0.5 text-xs font-medium',
              insight.status === 'published'
                ? 'bg-accent/10 text-accent'
                : 'bg-background text-muted',
            ].join(' ')}
          >
            {insight.status === 'published'
              ? t('publicApp.meInsight.published')
              : t('publicApp.meInsight.draft')}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">{t('publicApp.meInsight.subtitle')}</p>

      {needsKey && (
        <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          {t('publicApp.meInsight.needsKey')}{' '}
          <Link href="/me/settings" className="font-semibold text-accent underline">
            {t('publicApp.meInsight.configureKey')}
          </Link>
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {!loading && insight && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {insight.content}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void generate()}>
          {insight ? t('publicApp.meInsight.regenerate') : t('publicApp.meInsight.generate')}
        </Button>
        {insight && insight.status !== 'published' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void setPublished(true)}
          >
            {t('publicApp.meInsight.publish')}
          </Button>
        )}
        {insight && insight.status === 'published' && (
          <Button
            variant="cancel"
            size="sm"
            disabled={busy}
            onClick={() => void setPublished(false)}
          >
            {t('publicApp.meInsight.unpublish')}
          </Button>
        )}
      </div>
    </Card>
  );
}
