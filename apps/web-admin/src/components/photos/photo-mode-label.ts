import type { PhotoMode } from '@myclash/types';

/** The words for each photo mode: the club's mode panel and the platform's pages read them here. */
export const PHOTO_MODE_LABEL_KEYS = {
  off: 'organizer.photos.mode.off',
  live: 'organizer.photos.mode.live',
  approve: 'organizer.photos.mode.approve',
} as const satisfies Record<PhotoMode, string>;

/** A photo mode as the moderator reads it. */
export function photoModeLabel(mode: PhotoMode, t: (key: string) => string): string {
  return t(PHOTO_MODE_LABEL_KEYS[mode]);
}
