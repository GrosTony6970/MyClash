'use client';

/**
 * HEMA Ratings submission — Route: /org/[slug]/events/[eventId]/hema-ratings
 *
 * Pre-flight check for the submission bundle, then the download. The check
 * exists because HEMA Ratings matches fighters by NAME: a misspelling or a
 * missing rating ID silently creates a duplicate record upstream, and the
 * organiser has no way to see that from our side once the file is uploaded.
 *
 * Data: GET /events/:id/exports/hema-ratings/preview
 * File: GET /events/:id/exports/hema-ratings.zip (plain <a>, cookie auth)
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

const PORTAL_URL = 'https://hemaratings.com/submit/';
const FIGHTER_FINDER_URL = 'https://hemaratings.com/organizertools/fighterfinder/';

/** Mirrors SubmissionWarning in the API's hema-ratings-submission.ts. */
interface SubmissionWarning {
  code: string;
  count: number;
  samples: string[];
}

interface SubmissionPreview {
  files: string[];
  counts: {
    clubs: number;
    fighters: number;
    tournaments: number;
    matches: number;
    excludedMatches: number;
  };
  warnings: SubmissionWarning[];
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

const COUNT_ORDER = [
  'tournaments',
  'fighters',
  'clubs',
  'matches',
  'excludedMatches',
] as const satisfies readonly (keyof SubmissionPreview['counts'])[];

function usePreview(apiUrl: string, eventId: string, t: Translate) {
  const [preview, setPreview] = useState<SubmissionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Nothing is set synchronously here: `loading` starts true and the refresh
  // handler flips it back, so the effect body only ever schedules the fetch
  // (react-hooks/set-state-in-effect is an error in this app).
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<SubmissionPreview>(
      apiUrl,
      `/api/v1/events/${eventId}/exports/hema-ratings/preview`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (r.ok) {
          setPreview(r.data);
          setError(null);
          return;
        }
        // A 400 here is the deliberate kind gate (test/club events are not
        // rated), not a build failure — say which, or the operator only sees a
        // generic "could not build" and has no idea why. It is the FALLBACK
        // now, so the server still wins wherever it explains itself.
        const fallback =
          r.kind === 'http' && r.status === 400
            ? t('organizer.hemaRatings.blockedKind')
            : t('organizer.hemaRatings.error');
        const message = failureMessage(r, t, fallback);
        if (message) setError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, eventId, reloadToken, t]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  return { preview, loading, error, refresh };
}

export default function HemaRatingsSubmissionPage() {
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const { preview, loading, error, refresh } = usePreview(apiUrl, eventId, t);

  const canDownload = (preview?.counts.matches ?? 0) > 0;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <BackLink
        href={`/org/${slug}/events/${eventId}`}
        label={t('organizer.hemaRatings.backToEvent')}
        className="mb-2"
      />

      <header className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl">
          {t('organizer.hemaRatings.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('organizer.hemaRatings.description')}</p>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-muted">{t('organizer.hemaRatings.loading')}</p>}

      {!loading && preview && (
        <>
          <SummaryPanel preview={preview} t={t} />
          <WarningsPanel preview={preview} t={t} />
          <DownloadPanel
            href={`${apiUrl}/api/v1/events/${eventId}/exports/hema-ratings.zip`}
            canDownload={canDownload}
            onRefresh={refresh}
            t={t}
          />
        </>
      )}
    </main>
  );
}

// ── Panels ────────────────────────────────────────────────────────────────────

/** What the bundle contains, and which files it will hold. */
function SummaryPanel({ preview, t }: { preview: SubmissionPreview; t: Translate }) {
  return (
    <section className="mb-6 rounded-lg border border-border p-4">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.hemaRatings.countsTitle')}
      </h2>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-5">
        {COUNT_ORDER.map((key) => (
          <div key={key} className="rounded-md bg-surface p-2">
            <dt className="text-xs text-muted">{t(`organizer.hemaRatings.counts.${key}`)}</dt>
            <dd className="font-semibold text-foreground">{preview.counts[key]}</dd>
          </div>
        ))}
      </dl>

      {preview.files.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-medium uppercase text-muted">
            {t('organizer.hemaRatings.filesTitle')}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {preview.files.map((file) => (
              <li
                key={file}
                className="rounded-full bg-surface px-3 py-1 font-mono text-xs text-foreground-secondary"
              >
                {file}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Everything that would make HEMA Ratings mis-file a fighter. */
function WarningsPanel({ preview, t }: { preview: SubmissionPreview; t: Translate }) {
  const hasMissingIds = preview.warnings.some((w) => w.code === 'fighter_missing_hema_id');

  return (
    <section className="mb-6 rounded-lg border border-border p-4">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.hemaRatings.warningsTitle')}
      </h2>

      {preview.warnings.length === 0 ? (
        <p className="mt-3 text-sm text-success">{t('organizer.hemaRatings.noWarnings')}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {preview.warnings.map((warning) => (
            <WarningRow key={warning.code} warning={warning} t={t} />
          ))}
        </ul>
      )}

      {hasMissingIds && (
        <p className="mt-4 text-sm text-muted">
          {t('organizer.hemaRatings.fighterFinderHint')}{' '}
          <a
            href={FIGHTER_FINDER_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-accent underline"
          >
            {t('organizer.hemaRatings.fighterFinderLink')}
          </a>
        </p>
      )}
    </section>
  );
}

function WarningRow({ warning, t }: { warning: SubmissionWarning; t: Translate }) {
  const hidden = warning.count - warning.samples.length;
  return (
    <li>
      <p className="text-sm font-semibold text-foreground">
        {t(`organizer.hemaRatings.warnings.${warning.code}`)}{' '}
        <span className="font-normal text-muted">({warning.count})</span>
      </p>
      {warning.samples.length > 0 && (
        <p className="mt-1 text-sm text-foreground-secondary">
          {warning.samples.join(' · ')}
          {hidden > 0 && <> {t('organizer.hemaRatings.andMore', { count: hidden })}</>}
        </p>
      )}
    </li>
  );
}

/** Plain <a> so the browser downloads with the session cookie and no JS. */
function DownloadPanel({
  href,
  canDownload,
  onRefresh,
  t,
}: {
  href: string;
  canDownload: boolean;
  onRefresh: () => void;
  t: Translate;
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        {canDownload ? (
          <a
            href={href}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
          >
            {t('organizer.hemaRatings.download')}
          </a>
        ) : (
          <p className="text-sm text-muted">{t('organizer.hemaRatings.empty')}</p>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground"
        >
          {t('organizer.hemaRatings.reload')}
        </button>
      </div>
      <p className="mt-3 text-sm text-muted">{t('organizer.hemaRatings.uploadHint')}</p>
      <a
        href={PORTAL_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-sm font-semibold text-accent underline"
      >
        {t('organizer.hemaRatings.portalLink')}
      </a>
    </section>
  );
}
