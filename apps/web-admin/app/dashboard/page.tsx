'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';
import { resolvePostAuthDestination } from '../../src/lib/post-auth-destination';
import { getPublicApiUrl } from '@/lib/api-url';

type MeResponse = {
  type: 'claimed' | 'guest' | 'anonymous';
  admin?: {
    isSuperAdmin: boolean;
    organizations: Array<{ slug: string }>;
    hasLeagueRoles?: boolean;
  };
};

type Mode = 'redirecting' | 'chooser' | 'noWorkspace';

type Landing =
  | { kind: 'redirect'; href: string }
  | { kind: 'chooser'; organizerSlug: string }
  | { kind: 'noWorkspace' };

const apiUrl = getPublicApiUrl();

/**
 * Resolve where a freshly-authenticated admin session should go, from /me.
 *
 * Dual-role exception: a user who is BOTH the platform super-admin AND a member
 * of at least one organization gets a `chooser` (not an automatic /admin
 * redirect). Forcing /admin used to strand the "sole operator" — an organiser
 * who is also the super-admin — on the platform console with no path to their
 * tournaments. Pure super-admins (no org) still go straight to /admin.
 */
async function resolveLanding(): Promise<Landing> {
  const res = await fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' });
  if (!res.ok) return { kind: 'redirect', href: '/login' };

  const data = (await res.json()) as MeResponse;
  if (data.type !== 'claimed') return { kind: 'redirect', href: '/login' };

  const organizations = data.admin?.organizations ?? [];
  const firstOrg = organizations.find((organization) => Boolean(organization.slug));

  if (data.admin?.isSuperAdmin) {
    return firstOrg
      ? { kind: 'chooser', organizerSlug: firstOrg.slug }
      : { kind: 'redirect', href: '/admin' };
  }

  if (firstOrg) return { kind: 'redirect', href: `/org/${firstOrg.slug}` };

  // Checked AFTER the org branch: an org owner who also holds a personal league
  // grant keeps landing on the org workspace they use daily, and reaches
  // /leagues through the sidebar instead. This branch is for the account whose
  // only grant is a league — previously a dead end here.
  if (data.admin?.hasLeagueRoles) return { kind: 'redirect', href: '/leagues' };

  return { kind: 'noWorkspace' };
}

/**
 * /dashboard - landing page after organizer login. Resolves the user's admin
 * workspace, then either redirects or shows the dual-role workspace chooser.
 */
export default function DashboardPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('redirecting');
  const [organizerSlug, setOrganizerSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveLanding()
      .then((landing) => {
        if (cancelled) return;
        if (landing.kind === 'redirect') {
          window.location.href = landing.href;
        } else if (landing.kind === 'chooser') {
          setOrganizerSlug(landing.organizerSlug);
          setMode('chooser');
        } else {
          setMode('noWorkspace');
        }
      })
      .catch(() => {
        if (!cancelled) window.location.href = '/login';
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === 'chooser') {
    return <WorkspaceChooser t={t} organizerSlug={organizerSlug} />;
  }

  if (mode === 'noWorkspace') {
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

/**
 * Two-card picker shown to a super-admin who also belongs to an organization.
 * "Platform Admin" links to /admin; "Event organiser" resolves the organiser's
 * auto-picked event hub (same landing a pure organiser gets) so the two roles
 * behave identically once chosen.
 */
function WorkspaceChooser({
  t,
  organizerSlug,
}: {
  t: (key: string) => string;
  organizerSlug: string | null;
}) {
  const [navigating, setNavigating] = useState(false);

  async function goToOrganiser() {
    if (navigating) return;
    setNavigating(true);
    // Fall back to the org overview (always reachable by a super-admin) rather
    // than /dashboard, so a viewer-only membership can't loop back here.
    const fallback = organizerSlug ? `/org/${organizerSlug}` : '/dashboard';
    window.location.href = await resolvePostAuthDestination(fallback);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            {t('admin.dashboard.chooser.title')}
          </h1>
          <p className="mt-3 text-sm text-muted">{t('admin.dashboard.chooser.subtitle')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ChooserCard
            title={t('admin.dashboard.chooser.platformAdmin')}
            description={t('admin.dashboard.chooser.platformAdminDesc')}
            href="/admin"
          />
          <ChooserCard
            title={t('admin.dashboard.chooser.eventOrganiser')}
            description={t('admin.dashboard.chooser.eventOrganiserDesc')}
            onClick={() => {
              void goToOrganiser();
            }}
            disabled={navigating}
          />
        </div>
      </div>
    </main>
  );
}

/**
 * Presentational chooser card — renders as a link (href) or a button (onClick).
 */
function ChooserCard({
  title,
  description,
  href,
  onClick,
  disabled,
}: {
  title: string;
  description: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className =
    'group flex flex-col rounded-lg border border-border bg-surface p-6 text-left transition-colors hover:border-accent hover:bg-foreground/5 disabled:cursor-wait disabled:opacity-70';
  const inner = (
    <>
      <span className="font-display text-lg font-semibold text-foreground">{title}</span>
      <span className="mt-2 text-sm text-muted">{description}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {inner}
    </button>
  );
}
