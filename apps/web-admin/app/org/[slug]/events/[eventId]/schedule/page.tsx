'use client';

/* eslint-disable myclash/no-literal-string */

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
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

  const generateScheduleLabel = t('organizer.schedulePage.generateScheduleAction');
  const generateScheduleHint = t('organizer.schedulePage.generateScheduleHint');
  const generateGridLabel = t('organizer.schedulePage.generateGridAction');

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
              onClick={() => setTopSuggestNonce((n) => n + 1)}
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

      {/* Merged layout: programme planner on top, live grid below.
          The tabs split this surface in two and forced operators to
          switch context just to see how a config change affected the
          grid. Single scroll keeps both visible side-by-side. */}
      <div className="px-8 pb-4">
        <ProgrammePlanner
          eventId={eventId}
          topSuggestNonce={topSuggestNonce}
          generateScheduleLabel={generateScheduleLabel}
          generateGridLabel={generateGridLabel}
          onGenerateDone={() => setGridRefreshKey((k) => k + 1)}
        />
      </div>

      <div className="px-4 pb-8">
        <ScheduleGrid key={gridRefreshKey} slug={slug} eventId={eventId} />
      </div>
    </main>
  );
}
