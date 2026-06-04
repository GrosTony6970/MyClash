'use client';

import Link from 'next/link';
import { t } from '@myclash/i18n';

export interface PublicLeague {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  season_year?: number | null;
  status?: string | null;
  logo_url?: string | null;
  // Projected by /api/v1/leagues (Slice 2).
  event_count?: number | null;
  tournament_count?: number | null;
  groups?: Array<{ id: string; name: string; tournament_count: number }> | null;
}

function leagueHref(league: PublicLeague): string {
  return `/leagues/${encodeURIComponent(league.slug ?? league.id ?? '')}`;
}

function initialsFor(name: string | null | undefined): string {
  const value = (name ?? '').trim();
  if (!value) return '··';
  const parts = value.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function groupsBreakdown(groups: PublicLeague['groups']): string {
  if (!groups || groups.length === 0) return '—';
  return groups.map((g) => `${g.name} (${g.tournament_count})`).join(', ');
}

function LeagueRow({ league }: { league: PublicLeague }) {
  return (
    <Link
      href={leagueHref(league)}
      className="group flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 md:grid md:grid-cols-[auto_2fr_auto_auto_2fr_auto] md:items-center md:gap-4"
    >
      {league.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={league.logo_url}
          alt={league.name ?? ''}
          className="h-9 w-9 rounded-md border border-stone-200 bg-white object-contain"
        />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
          {initialsFor(league.name)}
        </div>
      )}
      <p className="font-display text-base font-semibold leading-tight text-slate-900">
        {league.name ?? '—'}
      </p>
      <p className="text-sm text-slate-700 tabular-nums">
        <span className="font-medium text-slate-600 md:hidden">
          {t('publicApp.home.colYear')} ·{' '}
        </span>
        {league.season_year ?? '—'}
      </p>
      <p className="text-sm text-slate-700 tabular-nums">
        <span className="font-medium text-slate-600 md:hidden">
          {t('publicApp.home.colEvents')} ·{' '}
        </span>
        {league.event_count ?? 0}
      </p>
      <p className="text-sm text-slate-500">
        <span className="font-medium text-slate-600 md:hidden">
          {t('publicApp.home.colGroups')} ·{' '}
        </span>
        {groupsBreakdown(league.groups)}
      </p>
      <p className="text-sm text-slate-700 tabular-nums">
        <span className="font-medium text-slate-600 md:hidden">
          {t('publicApp.home.colTournaments')} ·{' '}
        </span>
        {league.tournament_count ?? 0}
      </p>
    </Link>
  );
}

function LeagueTableHeader() {
  return (
    <div
      role="row"
      className="hidden md:grid md:grid-cols-[auto_2fr_auto_auto_2fr_auto] md:items-center md:gap-4 md:border-b md:border-stone-200 md:px-4 md:py-2 md:text-xs md:font-semibold md:uppercase md:tracking-wider md:text-slate-500"
    >
      <span role="columnheader" aria-label={t('publicApp.home.colLogo')}>
        {' '}
      </span>
      <span role="columnheader">{t('publicApp.home.colName')}</span>
      <span role="columnheader">{t('publicApp.home.colYear')}</span>
      <span role="columnheader">{t('publicApp.home.colEvents')}</span>
      <span role="columnheader">{t('publicApp.home.colGroups')}</span>
      <span role="columnheader">{t('publicApp.home.colTournaments')}</span>
    </div>
  );
}

function SectionHeader({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-display text-lg font-semibold text-slate-900">
        {title}
      </h2>
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{count}</span>
    </div>
  );
}

export function PublicLeaguesSections({ leagues }: { leagues: PublicLeague[] }) {
  if (leagues.length === 0) {
    return (
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          {t('publicApp.home.leaguesEmptyTitle')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {t('publicApp.home.leaguesEmptyDescription')}
        </p>
      </section>
    );
  }

  const currentYear = new Date().getFullYear();
  const active = leagues.filter((l) => (l.season_year ?? 0) >= currentYear);
  const past = leagues.filter((l) => (l.season_year ?? 0) < currentYear);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="public-leagues-active-title" className="flex flex-col gap-3">
        <SectionHeader
          id="public-leagues-active-title"
          title={t('publicApp.home.sectionActiveLeagues')}
          count={active.length}
        />
        {active.length > 0 && (
          <div role="table" aria-labelledby="public-leagues-active-title">
            <LeagueTableHeader />
            <div className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-stone-100">
              {active.map((league) => (
                <LeagueRow key={league.slug ?? league.id} league={league} />
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="public-leagues-past-title" className="flex flex-col gap-3">
        <SectionHeader
          id="public-leagues-past-title"
          title={t('publicApp.home.sectionPastLeagues')}
          count={past.length}
        />
        {past.length > 0 && (
          <div
            role="table"
            aria-labelledby="public-leagues-past-title"
            className="max-h-[60vh] overflow-y-auto"
          >
            <LeagueTableHeader />
            <div className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-stone-100">
              {past.map((league) => (
                <LeagueRow key={league.slug ?? league.id} league={league} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
