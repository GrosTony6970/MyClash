'use client';

/* eslint-disable myclash/no-literal-string */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Drawer } from '@myclash/ui';
import { ProgrammePlanner } from './programme';
import { ScheduleGrid } from './grid';
import { LiveNowBanner } from './live-now-banner';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

export default function SchedulePage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const { t } = useI18n();

  // Bumping these nonces tells the children to act:
  //   - topSuggestNonce → planner re-runs `suggest()` (Generate schedule)
  //   - gridRefreshKey  → grid remounts after a Generate Grid run so it
  //                       re-fetches matches + programme blocks.
  const [topSuggestNonce, setTopSuggestNonce] = useState(0);
  const [gridRefreshKey, setGridRefreshKey] = useState(0);

  // The Programme Planner now lives inside a slide-over Drawer that
  // the operator opens via the `⚙ Configure schedule` button. The
  // grid takes the full page; this matches the operator's actual
  // workflow (setup once, drag-place 90% of the time).
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Hash deep-link: `/schedule#configure` auto-opens the drawer so
  // operators can share "go here to set this up" URLs. We sync once
  // on mount + listen for hashchange (matches the TournamentTabs
  // pattern used on the public side).
  useEffect(() => {
    function syncFromHash() {
      if (typeof window === 'undefined') return;
      if (window.location.hash === '#configure') setDrawerOpen(true);
    }
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  const generateScheduleLabel = t('organizer.schedulePage.generateScheduleAction');
  const generateScheduleHint = t('organizer.schedulePage.generateScheduleHint');
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
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              ⚙ {configureLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setDrawerOpen(true);
                setTopSuggestNonce((n) => n + 1);
              }}
              title={generateScheduleHint}
              className="rounded-lg bg-red-700 hover:bg-red-800 px-3 py-2 text-sm font-semibold text-white"
            >
              ✦ {generateScheduleLabel}
            </button>
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

      {/* Grid is the workspace — full page width. Programme Planner
          lives in the slide-over drawer below; it doesn't compete
          for vertical real estate anymore. */}
      <div className="px-4 pb-8">
        <ScheduleGrid key={gridRefreshKey} slug={slug} eventId={eventId} />
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={configureLabel}>
        <ProgrammePlanner
          eventId={eventId}
          topSuggestNonce={topSuggestNonce}
          generateScheduleLabel={generateScheduleLabel}
          generateGridLabel={generateGridLabel}
          onGenerateDone={() => {
            setGridRefreshKey((k) => k + 1);
            setDrawerOpen(false);
          }}
        />
      </Drawer>
    </main>
  );
}
