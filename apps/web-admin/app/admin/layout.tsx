import type { ReactNode } from 'react';
import { SuperAdminShell } from '../../src/components/SuperAdminShell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <SuperAdminShell>{children}</SuperAdminShell>;
}
