/* eslint-disable myclash/no-literal-string -- pre-i18n public page (matches the workshop detail page). */

/**
 * Workshop catalog — T-803
 * Route: /e/[eventSlug]/workshops
 *
 * AC:
 *   ✓ Fuzzy search (title or instructor) + category/level/language filters
 *   ✓ Anonymous can browse; enroll requires login
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getApiUrl } from '@/lib/api-url';
import { WorkshopsBrowser, type WorkshopListItem } from './WorkshopsBrowser';
import { fetchEventInfo } from '../_components/EventHeader';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return { title: `Workshops — ${eventSlug}` };
}

async function fetchWorkshops(eventSlug: string, apiUrl: string): Promise<WorkshopListItem[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/public-workshops`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as WorkshopListItem[];
  } catch {
    return [];
  }
}

export default async function WorkshopsPage({ params }: Props) {
  const { eventSlug } = await params;
  const apiUrl = getApiUrl();
  const [workshops, event] = await Promise.all([
    fetchWorkshops(eventSlug, apiUrl),
    fetchEventInfo(eventSlug, apiUrl),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link
        href={`/e/${eventSlug}/home`}
        className="mb-4 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-500 hover:bg-slate-50"
      >
        ← Back to event home
      </Link>
      <h1
        className="mb-4 text-2xl font-bold"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
      >
        Workshops
      </h1>

      <WorkshopsBrowser
        workshops={workshops}
        eventSlug={eventSlug}
        timezone={event?.timezone ?? 'Europe/Paris'}
      />
    </main>
  );
}
