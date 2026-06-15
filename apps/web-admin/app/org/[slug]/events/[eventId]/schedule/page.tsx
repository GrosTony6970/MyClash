'use client';

/* eslint-disable myclash/no-literal-string */

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { GenerateResult } from '@myclash/types';
import { ProgrammePlanner } from './programme';
import { ScheduleGrid } from './grid';
import { LiveNowBanner } from './live-now-banner';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

export default function SchedulePage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const { t } = useI18n();

  // Bumping these nonces tells the children to act:
  //   - topSuggestNonce       → planner re-runs `suggest()` (Generate schedule)
  //   - gridRefreshKey        → grid remounts after a Generate Grid run so it
  //                             re-fetches matches + programme blocks (drawer → grid).
  //   - programmeRefreshKey   → planner re-runs its mount fetch after the grid
  //                             mutates a block (inline ×, drag-move). Symmetric to
  //                             gridRefreshKey so both surfaces stay in sync (grid → drawer).
  const [topSuggestNonce, setTopSuggestNonce] = useState(0);
  const [gridRefreshKey, setGridRefreshKey] = useState(0);
  const [programmeRefreshKey, setProgrammeRefreshKey] = useState(0);

  // Toast surfaces the GenerateResult above the grid after a Generate run.
  const [generateToast, setGenerateToast] = useState<GenerateResult | null>(null);
  const [toastDetailsOpen, setToastDetailsOpen] = useState(false);

  const generateScheduleLabel = t('organizer.schedulePage.generateScheduleAction');
  const generateGridLabel = t('organizer.schedulePage.generateGridAction');
  const configureLabel = t('organizer.schedulePage.configureAction');

  return (
    <main>
      <div className="px-8 pt-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
          <Link href={`/org/${slug}`} className="hover:text-gray-700">
            {slug}
          </Link>
          <span>/</span>
          <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
            Event
          </Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">Schedule</span>
        </div>
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">Schedule</h1>
          <div className="flex items-center gap-2">
            <Link
              href={`/org/${slug}/events/${eventId}/ai-assistant?type=schedule_grid`}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('organizer.aiAssistant.suggest')}
            </Link>
          </div>
        </div>

        <LiveNowBanner eventId={eventId} />
      </div>

      {generateToast && (
        <div className="px-8 pb-4">
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          >
            <span className="font-semibold">
              ✓ {t('organizer.schedulePage.generateToastTitle')} {generateToast.matchesScheduled}{' '}
              matches, {generateToast.workshopSessionsCreated} workshops
            </span>
            {generateToast.blockDiagnostics && generateToast.blockDiagnostics.length > 0 && (
              <button
                type="button"
                onClick={() => setToastDetailsOpen((v) => !v)}
                className="text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
              >
                {toastDetailsOpen
                  ? t('organizer.schedulePage.generateToastHideDetails')
                  : t('organizer.schedulePage.generateToastShowDetails')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setGenerateToast(null);
                setToastDetailsOpen(false);
              }}
              aria-label={t('organizer.schedulePage.generateToastDismiss')}
              className="ml-auto text-emerald-700 hover:text-emerald-950"
            >
              ✕
            </button>
          </div>
          {toastDetailsOpen && generateToast.blockDiagnostics && (
            <ul className="mt-2 space-y-0.5 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-xs text-slate-700">
              {generateToast.blockDiagnostics.map((d) => {
                const ok = d.scheduledMatches > 0;
                const empty = d.fetchedMatches === 0;
                const noLices = d.licesAvailable === 0;
                return (
                  <li key={d.blockId}>
                    <span className="font-mono">
                      {ok ? '✓' : empty ? '∅' : noLices ? '⚠' : '×'}
                    </span>{' '}
                    <span className="font-medium">{d.blockLabel}</span>
                    {' — '}
                    {d.scheduledMatches}/{d.fetchedMatches} scheduled on {d.licesAvailable} lice
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Grid is the workspace; the Configure (Programme Planner) panel now
          lives in the grid's right sidebar, under the Unscheduled list. */}
      <div className="px-4 pb-8">
        <ScheduleGrid
          key={gridRefreshKey}
          slug={slug}
          eventId={eventId}
          onProgrammeMutated={() => setProgrammeRefreshKey((k) => k + 1)}
          configurePanel={
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {configureLabel}
              </h2>
              <ProgrammePlanner
                eventId={eventId}
                topSuggestNonce={topSuggestNonce}
                programmeRefreshKey={programmeRefreshKey}
                generateScheduleLabel={generateScheduleLabel}
                generateGridLabel={generateGridLabel}
                onGenerateDone={(result) => {
                  setGridRefreshKey((k) => k + 1);
                  setGenerateToast(result);
                  setToastDetailsOpen(false);
                }}
                onBlocksChanged={() => setGridRefreshKey((k) => k + 1)}
              />
            </div>
          }
        />
      </div>
    </main>
  );
}
