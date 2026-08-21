import type { ReactNode } from 'react';
import { StaffScreen } from '../../src/components/StaffScreen';

/**
 * Exists only to put the role gate in front of the gear table.
 *
 * A layout rather than a wrapper inside `page.tsx`: it leaves the page
 * component untouched, and it covers any route added under `/gear` later
 * without anyone having to remember. `StaffScreen` explains what the gate does
 * and why it is a courtesy rather than a boundary.
 */
export default function GearLayout({ children }: { children: ReactNode }) {
  return <StaffScreen requires="gear">{children}</StaffScreen>;
}
