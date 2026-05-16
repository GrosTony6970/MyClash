'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';

interface PersonalSpaceResponse {
  user: {
    id: string;
    email: string;
    display_name?: string;
  };
  profiles: {
    globalPerson: Record<string, unknown> | null;
    claimedPersons: Record<string, unknown>[];
  };
  commitments: {
    refereeAssignments: Record<string, unknown>[];
    workshopEnrollments: Record<string, unknown>[];
  };
  counts: {
    claimedPersons: number;
    events: number;
    refereeAssignments: number;
    workshopEnrollments: number;
  };
}

function roleEnabled(profile: Record<string, unknown> | null, key: string) {
  return Boolean(profile?.[key]);
}

export function PersonalSpaceDashboard({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<PersonalSpaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/me/personal-space`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace('/login');
          return;
        }
        if (!response.ok) throw new Error('personal-space');
        setData((await response.json()) as PersonalSpaceResponse);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [apiUrl]);

  const globalPerson = data?.profiles.globalPerson ?? null;
  const displayName =
    data?.user.display_name ||
    (typeof globalPerson?.['display_name'] === 'string'
      ? (globalPerson['display_name'] as string)
      : data?.user.email);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1d4ed8]">
            {t('publicApp.personalSpace.eyebrow')}
          </p>
          <h1 className="mt-2 text-3xl font-black text-[#0f172a]">
            {t('publicApp.personalSpace.title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {t('publicApp.personalSpace.subtitle', {
              name: displayName ?? t('common.unknown'),
            })}
          </p>
        </header>

        {loading && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">
            {t('publicApp.personalSpace.loading')}
          </section>
        )}

        {error && (
          <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
            {t('publicApp.personalSpace.loadError')}
          </section>
        )}

        {data && (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t('publicApp.personalSpace.stats.claimedProfiles')}
                value={data.counts.claimedPersons}
              />
              <StatCard
                label={t('publicApp.personalSpace.stats.events')}
                value={data.counts.events}
              />
              <StatCard
                label={t('publicApp.personalSpace.stats.refereeAssignments')}
                value={data.counts.refereeAssignments}
              />
              <StatCard
                label={t('publicApp.personalSpace.stats.workshops')}
                value={data.counts.workshopEnrollments}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black text-[#0f172a]">
                  {t('publicApp.personalSpace.profileTitle')}
                </h2>
                {globalPerson ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <RolePill
                      active={roleEnabled(globalPerson, 'is_fighter')}
                      label={t('publicApp.personalSpace.roles.fighter')}
                    />
                    <RolePill
                      active={roleEnabled(globalPerson, 'is_referee')}
                      label={t('publicApp.personalSpace.roles.referee')}
                    />
                    <RolePill
                      active={roleEnabled(globalPerson, 'is_workshop_participant')}
                      label={t('publicApp.personalSpace.roles.workshopParticipant')}
                    />
                  </div>
                ) : (
                  <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-700">
                      {t('publicApp.personalSpace.emptyProfileTitle')}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {t('publicApp.personalSpace.emptyProfileDescription')}
                    </p>
                    <Link
                      href="/"
                      className="mt-4 inline-flex rounded-md bg-[#1d4ed8] px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
                    >
                      {t('publicApp.personalSpace.findEvents')}
                    </Link>
                  </div>
                )}
              </div>

              <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black text-[#0f172a]">
                  {t('publicApp.personalSpace.quickActions')}
                </h2>
                <div className="mt-4 grid gap-2">
                  <QuickLink href="/me/fighter" label={t('publicApp.personalShell.nav.fighter')} />
                  <QuickLink href="/me/referee" label={t('publicApp.personalShell.nav.referee')} />
                  <QuickLink
                    href="/me/notifications"
                    label={t('publicApp.personalShell.nav.notifications')}
                  />
                </div>
              </aside>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black tabular-nums text-[#0f172a]">{value}</p>
    </article>
  );
}

function RolePill({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      className={[
        'rounded-md border px-3 py-3 text-sm font-bold',
        active
          ? 'border-[#1d4ed8]/30 bg-[#1d4ed8]/10 text-[#1d4ed8]'
          : 'border-slate-200 bg-slate-50 text-slate-400',
      ].join(' ')}
    >
      {label}
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1d4ed8]/40 hover:bg-[#1d4ed8]/10 hover:text-[#1d4ed8]"
    >
      {label}
    </Link>
  );
}
