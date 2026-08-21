import type { ReactNode } from 'react';
import { StaffScreen } from '../../src/components/StaffScreen';

/**
 * The role gate in front of the scoring pad. Separate from `lices/layout.tsx`
 * because the admin bracket deep-links here with no lice context.
 * See `app/gear/layout.tsx`.
 */
export default function MatchesLayout({ children }: { children: ReactNode }) {
  return <StaffScreen requires="scoring">{children}</StaffScreen>;
}
