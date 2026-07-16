'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';

type MeResponse = {
  type: 'claimed' | 'guest' | 'anonymous';
  admin?: {
    isSuperAdmin: boolean;
    organizations: Array<{ slug: string }>;
    hasLeagueRoles?: boolean;
  };
};

/**
 * /dashboard - landing page after organizer login.
 * Fetches /api/v1/me to find the user's admin workspace, then redirects.
 */
export default function DashboardPage() {
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [noWorkspace, setNoWorkspace] = useState(false);

  useEffect(() => {
    async function redirect() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' });
        if (!res.ok) {
          window.location.href = '/login';
          return;
        }

        const data = (await res.json()) as MeResponse;
        if (data.type !== 'claimed') {
          window.location.href = '/login';
          return;
        }

        if (data.admin?.isSuperAdmin) {
          window.location.href = '/admin';
          return;
        }

        const firstOrganization = data.admin?.organizations.find((organization) =>
          Boolean(organization.slug),
        );
        if (firstOrganization) {
          window.location.href = `/org/${firstOrganization.slug}`;
          return;
        }

        // Checked AFTER the org branch: an org owner who also holds a personal
        // league grant keeps landing on the org workspace they use daily, and
        // reaches /leagues through the sidebar instead. This branch is for the
        // account whose only grant is a league — previously a dead end here.
        if (data.admin?.hasLeagueRoles) {
          window.location.href = '/leagues';
          return;
        }

        setNoWorkspace(true);
      } catch {
        window.location.href = '/login';
      }
    }

    void redirect();
  }, [apiUrl]);

  if (noWorkspace) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('admin.dashboard.noWorkspaceTitle')}
          </h1>
          <p className="mt-3 text-sm text-muted">{t('admin.dashboard.noWorkspaceDescription')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted">{t('admin.dashboard.redirecting')}</p>
    </main>
  );
}
