import type { PhotoMode } from '@myclash/types';

/** A photo mode as the moderator reads it: the same words as the club page's mode panel. */
export function photoModeLabel(mode: PhotoMode, t: (key: string) => string): string {
  switch (mode) {
    case 'off':
      return t('organizer.photos.mode.off');
    case 'live':
      return t('organizer.photos.mode.live');
    case 'approve':
      return t('organizer.photos.mode.approve');
  }
}
