/**
 * Workshop catalog — T-803
 * Route: /e/[eventSlug]/workshops
 *
 * AC:
 *   ✓ Fuzzy search (title or instructor) + category/level/language filters
 *   ✓ Anonymous can browse; enroll requires login
 */

import type { Metadata } from 'next';
import { BackLink } from '@/components/BackLink';
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT } from '@/i18n/server-locale';
import { WorkshopsBrowser, type WorkshopListItem } from './WorkshopsBrowser';
import { fetchEventInfo } from '../_components/EventHeader';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  const t = await getServerT();
  return { title: t('publicApp.workshops.metadataTitle', { name: eventSlug }) };
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
  const t = await getServerT();
  const apiUrl = getServerApiUrl();
  const [workshops, event] = await Promise.all([
    fetchWorkshops(eventSlug, apiUrl),
    fetchEventInfo(eventSlug, apiUrl),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={t('publicApp.eventHome.backToHome')}
        className="mb-4"
      />
      <h1
        className="mb-4 font-display text-2xl font-bold sm:text-3xl"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
      >
        {t('publicApp.eventHome.section.workshops')}
      </h1>

      <WorkshopsBrowser
        workshops={workshops}
        eventSlug={eventSlug}
        timezone={event?.timezone ?? 'Europe/Paris'}
      />
    </main>
  );
}
