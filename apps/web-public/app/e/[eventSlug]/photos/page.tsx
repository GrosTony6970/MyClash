/**
 * An Event's public photos: `/e/<slug>/photos` (design, "Where it shows up" item 3; ruling 446).
 * Reached from the Event home's card while photos are on; with photos Off it is the not-found
 * page. Search engines are told to leave it out: it shows people's faces for 30 days.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BackLink } from '@/components/BackLink';
import { getServerApiUrl } from '@/lib/api-url';
import { titled } from '@/lib/page-metadata';
import { getServerT } from '@myclash/next-i18n/server';
import { photosShown } from '@myclash/types';
import { eventOrNotFound } from '../_lib/event-or-not-found';
import { readPhotoTags } from './_lib/photo-tags';
import { PhotoGrid } from './PhotoGrid';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

const title = titled('publicApp.titles.photos');

export async function generateMetadata(): Promise<Metadata> {
  return { ...(await title()), robots: { index: false, follow: false } };
}

export default async function PhotosPage({ params }: Props) {
  const { eventSlug } = await params;
  const t = await getServerT();
  const apiUrl = getServerApiUrl();
  const event = await eventOrNotFound(eventSlug);
  // Off, or a stored mode this build does not know: closed, as the server's list is.
  if (!photosShown(event.photoMode)) notFound();
  const tags = await readPhotoTags(event.id, eventSlug, apiUrl);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-6">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={t('publicApp.eventHome.backToHome')}
        className="mb-4"
      />
      <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
        {t('publicApp.photos.title')}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">{event.name}</p>
      <PhotoGrid eventId={event.id} timeZone={event.timezone} tags={tags} />
    </main>
  );
}
