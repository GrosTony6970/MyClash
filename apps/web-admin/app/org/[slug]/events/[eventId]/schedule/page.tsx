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
  const [tab, setTab] = useState<'programme' | 'grid'>('programme');

  return (
    <main className="p-8">
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
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <Link
          href={`/org/${slug}/events/${eventId}/ai-assistant?type=schedule_grid`}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('organizer.aiAssistant.suggest')}
        </Link>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(['programme', 'grid'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
              tab === t
                ? 'bg-white border border-b-white border-gray-200 text-gray-900 -mb-px'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t === 'programme' ? 'Programme' : 'Grid'}
          </button>
        ))}
      </div>

      <LiveNowBanner eventId={eventId} />

      {tab === 'programme' ? (
        <ProgrammePlanner eventId={eventId} onGenerateDone={() => setTab('grid')} />
      ) : (
        <ScheduleGrid slug={slug} eventId={eventId} />
      )}
    </main>
  );
}
