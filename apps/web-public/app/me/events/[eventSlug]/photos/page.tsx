import { getServerApiUrl } from '@/lib/api-url';
import { readEventOnce } from '../../../../e/[eventSlug]/_lib/event-or-not-found';
import type { PhotoTags } from '../../../../e/[eventSlug]/photos/_components/TagOptions';
import { readPhotoTags } from '../../../../e/[eventSlug]/photos/_lib/photo-tags';
import { HubPhotosPage } from './HubPhotosPage';

const NO_TAGS: PhotoTags = { tournaments: [], workshops: [] };

/**
 * The Photos tab of one of her Events (design Goal 11, "Where it shows up" item 5; slice 6b). The
 * Tournaments and Workshops a photo can be about are read here, on the server with her login, as
 * the QR page reads them; the rest is drawn in her browser, as every tab of the hub. An Event the
 * read cannot see gets no tags (the hub says what to show); a read that failed throws, so the
 * segment's error page offers Try again.
 */
export default async function HubPhotosRoute({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const read = await readEventOnce(eventSlug);
  if (read.kind === 'failed') throw new Error(`The read of the Event "${eventSlug}" failed`);
  const tags =
    read.kind === 'found'
      ? await readPhotoTags(read.event.id, eventSlug, getServerApiUrl())
      : NO_TAGS;
  return <HubPhotosPage tags={tags} />;
}
