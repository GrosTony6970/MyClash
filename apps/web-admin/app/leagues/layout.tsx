import type { ReactNode } from 'react';
import { LeagueWorkspaceShell } from '../../src/components/LeagueWorkspaceShell';

/**
 * Deliberately OUTSIDE app/admin (super-admin only) and app/org/[slug] (org
 * members only): a league can be administered by an individual account that is
 * neither, and this is the only workspace those accounts have.
 */
export default function LeaguesLayout({ children }: { children: ReactNode }) {
  return <LeagueWorkspaceShell>{children}</LeagueWorkspaceShell>;
}
