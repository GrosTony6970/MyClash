import Link from 'next/link';
import { photosShown, type PhotoMode } from '@myclash/types';

/**
 * The Event home's door to its photos (ruling 446): shown while photos are on, Live or Approve
 * first. Off, or a stored mode the page does not know (null), shows nothing: the page would be
 * the not-found one. It stays after the deletion date (ruling 451): the page then says why it is
 * empty.
 */
export function PhotosCard({
  eventSlug,
  photoMode,
  tr,
}: {
  eventSlug: string;
  photoMode: PhotoMode | null;
  tr: (key: string) => string;
}) {
  if (!photosShown(photoMode)) return null;
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {tr('publicApp.photos.title')}
      </h2>
      <Link
        href={`/e/${eventSlug}/photos`}
        className="group block max-w-sm rounded-xl border border-border bg-surface p-5 shadow-sm transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        <p className="text-xs font-semibold text-accent group-hover:text-accent-hover">
          {tr('publicApp.photos.cardLine')}
        </p>
      </Link>
    </section>
  );
}
