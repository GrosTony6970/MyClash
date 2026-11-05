/**
 * The page an Event's photo QR code opens: `/e/<slug>/photos/send#<token>` (design, "Where it
 * shows up" item 2). Made for a phone; reached only from the printed link, so no page links here
 * and search engines are told to leave it out.
 */

import type { Metadata } from 'next';
import { BackLink } from '@/components/BackLink';
import { getServerApiUrl } from '@/lib/api-url';
import { titled } from '@/lib/page-metadata';
import { getServerT } from '@myclash/next-i18n/server';
import { eventOrNotFound } from '../../_lib/event-or-not-found';
import { readPhotoTags } from '../_lib/photo-tags';
import { PhotoSendForm } from './PhotoSendForm';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

const title = titled('publicApp.titles.photoSend');

export async function generateMetadata(): Promise<Metadata> {
  return { ...(await title()), robots: { index: false, follow: false } };
}

export default async function PhotoSendPage({ params }: Props) {
  const { eventSlug } = await params;
  const t = await getServerT();
  const apiUrl = getServerApiUrl();
  const event = await eventOrNotFound(eventSlug);
  const tags = await readPhotoTags(event.id, eventSlug, apiUrl);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={t('publicApp.eventHome.backToHome')}
        className="mb-4"
      />
      <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
        {t('publicApp.photoSend.title')}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">{event.name}</p>
      <PhotoSendForm
        eventId={event.id}
        eventSlug={eventSlug}
        photoMode={event.photoMode}
        tags={tags}
      />
    </main>
  );
}
