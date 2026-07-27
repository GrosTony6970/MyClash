'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';

interface FollowedOrganization {
  organizationId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
}

type Status = 'loading' | 'ready' | 'unauthorized' | 'error';

/**
 * "Organisers" tab of the People hub: the organisations you follow, each
 * linking to its public page, with an unfollow control.
 *
 * This is also the app's main inbound path to /o/[slug] — the landing-page
 * event cards can't link there yet without restructuring the card grid.
 */
export function OrganizersTab({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>('loading');
  const [orgs, setOrgs] = useState<FollowedOrganization[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Declared inside the effect on purpose: react-hooks/set-state-in-effect
  // flags a hoisted callback invoked from the effect body, because it cannot
  // see that every setState is behind an await.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/me/follows/organizations`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (res.status === 401) {
          setStatus('unauthorized');
          return;
        }
        if (!res.ok) {
          setStatus('error');
          return;
        }
        setOrgs((await res.json()) as FollowedOrganization[]);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }

    void load();
    return () => controller.abort();
  }, [apiUrl]);

  async function unfollow(organizationId: string) {
    if (busyId) return;
    setBusyId(organizationId);
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/follows/organizations/${organizationId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      // Drop it locally rather than refetching — the row is gone either way,
      // and a refetch would flash the whole list.
      if (res.ok) setOrgs((prev) => prev.filter((o) => o.organizationId !== organizationId));
    } finally {
      setBusyId(null);
    }
  }

  if (status === 'loading') {
    return <p className="text-sm text-muted">{t('publicApp.me.organizers.loading')}</p>;
  }
  if (status === 'unauthorized') {
    return <EmptyState title={t('publicApp.me.people.signInToManage')} />;
  }
  if (status === 'error') {
    return <EmptyState title={t('publicApp.me.organizers.loadError')} />;
  }
  if (orgs.length === 0) {
    return <EmptyState title={t('publicApp.me.organizers.empty')} />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {orgs.map((org) => (
        <li
          key={org.organizationId}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
        >
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logoUrl}
              alt=""
              className="h-10 w-10 flex-shrink-0 rounded-lg border border-border object-contain p-0.5"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-border text-lg"
            >
              🛡️
            </span>
          )}
          <Link
            href={`/o/${org.slug}`}
            className="min-w-0 flex-1 font-semibold text-foreground hover:underline"
          >
            {org.name}
          </Link>
          <button
            type="button"
            onClick={() => void unfollow(org.organizationId)}
            disabled={busyId === org.organizationId}
            className="flex-shrink-0 rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors disabled:cursor-default"
          >
            {busyId === org.organizationId ? '…' : t('publicApp.organizer.following')}
          </button>
        </li>
      ))}
    </ul>
  );
}
