'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ProgrammePlanner } from './programme';
import { ScheduleGrid } from './grid';
import { LiveNowBanner } from './live-now-banner';

export default function SchedulePage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
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
      <h1 className="text-2xl font-bold mb-4">Schedule</h1>

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
