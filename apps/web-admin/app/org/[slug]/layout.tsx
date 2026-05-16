import type { ReactNode } from 'react';
import { OrganizerAdminShell } from '../../../src/components/OrganizerAdminShell';

export default function OrganizerLayout({ children }: { children: ReactNode }) {
  return <OrganizerAdminShell>{children}</OrganizerAdminShell>;
}
