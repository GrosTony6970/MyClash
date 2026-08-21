import type { ReactNode } from 'react';
import { StaffScreen } from '../../src/components/StaffScreen';

/**
 * The role gate in front of the piste screens — the picker AND `[liceId]`,
 * which inherits this. See `app/gear/layout.tsx`.
 */
export default function LicesLayout({ children }: { children: ReactNode }) {
  return <StaffScreen requires="scoring">{children}</StaffScreen>;
}
