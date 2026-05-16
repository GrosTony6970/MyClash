import type { ReactNode } from 'react';
import { PublicPersonalShell } from '../../src/components/PublicPersonalShell';

export default function PersonalSpaceLayout({ children }: { children: ReactNode }) {
  return <PublicPersonalShell>{children}</PublicPersonalShell>;
}
