import type { ReactNode } from 'react';
import { StaffScreen } from '../../src/components/StaffScreen';

/**
 * The role gate in front of the photo queue. See `app/gear/layout.tsx`. The screen is online only:
 * it is not one of the service worker's shells (`public/sw.js`), so the scoring pad's offline
 * behaviour is unchanged (hard rule 3).
 */
export default function PhotosLayout({ children }: { children: ReactNode }) {
  return <StaffScreen requires="photos">{children}</StaffScreen>;
}
