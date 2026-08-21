import type { ReactNode } from 'react';
import { StaffScreen } from '../../src/components/StaffScreen';

/** The role gate in front of the check-in desk. See `app/gear/layout.tsx`. */
export default function DeskLayout({ children }: { children: ReactNode }) {
  return <StaffScreen requires="checkin">{children}</StaffScreen>;
}
