'use client';

import { useI18n } from '@myclash/next-i18n/client';
import Link from 'next/link';

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

// Active leagues get the same emerald the LiveTag uses on events;
// past leagues get the slate that PastTag uses. Inline style avoids
// safelisting arbitrary `border-l-[#…]` Tailwind classes (the
// EventsListSections row uses the same inline-style trick for the
// org's brand colour).
const ACCENT_ACTIVE = '#059669'; // emerald-600
const ACCENT_PAST = '#94a3b8'; // slate-400

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

function LeagueLogo({ league }: { league: PublicLeague }) {
  if (league.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={league.logo_url}
        alt={league.name ?? ''}
        className="h-10 w-10 shrink-0 rounded border border-border bg-surface object-contain"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-background text-[11px] font-semibold text-muted">
      {initialsFor(league.name)}
    </div>
  );
}

function LeagueActiveTag() {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-center rounded-full border border-success/60 bg-success/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-success">
      {t('publicApp.home.leagueStatusActive')}
    </span>
  );
}

function LeaguePastTag() {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-center rounded-full border border-border bg-border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
      {t('publicApp.home.leagueStatusPast')}
    </span>
  );
}

function LeagueRow({ league, variant }: { league: PublicLeague; variant: 'active' | 'past' }) {
  const { t } = useI18n();

  const accentColor = variant === 'active' ? ACCENT_ACTIVE : ACCENT_PAST;
  const tag = variant === 'active' ? <LeagueActiveTag /> : <LeaguePastTag />;
  return (
    <Link
      href={leagueHref(league)}
      style={{ borderLeftColor: accentColor }}
      className="group flex flex-col gap-3 rounded-lg border border-border border-l-4 bg-surface p-4 shadow-sm transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent md:grid md:grid-cols-[auto_2fr_1fr_1fr_auto_auto] md:items-center md:gap-4"
    >
      <LeagueLogo league={league} />
      <div className="min-w-0">
        <p className="font-display text-base font-semibold leading-tight text-foreground">
          {league.name ?? '—'}
        </p>
        {league.season_year != null && (
          <p className="mt-0.5 text-xs text-muted tabular-nums">{league.season_year}</p>
        )}
      </div>
      <p className="text-sm text-foreground-secondary tabular-nums">
        <span className="font-medium text-foreground-secondary md:hidden">
          {t('publicApp.home.colEvents')} ·{' '}
        </span>
        {league.event_count ?? 0}
      </p>
      <p className="truncate text-sm text-muted">
        <span className="font-medium text-foreground-secondary md:hidden">
          {t('publicApp.home.colGroups')} ·{' '}
        </span>
        {groupsBreakdown(league.groups)}
      </p>
      <span className="self-start md:self-center">{tag}</span>
      <span className="text-sm font-semibold text-accent group-hover:text-accent-hover">
        {t('publicApp.home.openLeague')}
      </span>
    </Link>
  );
}

function LeagueTableHeader() {
  const { t } = useI18n();

  return (
    <div
      role="row"
      className="hidden md:grid md:grid-cols-[auto_2fr_1fr_1fr_auto_auto] md:items-center md:gap-4 md:border-b md:border-border md:px-4 md:py-2 md:text-xs md:font-semibold md:uppercase md:tracking-wider md:text-muted"
    >
      <span role="columnheader" aria-label={t('publicApp.home.colLogo')}>
        {' '}
      </span>
      <span role="columnheader">{t('publicApp.home.colName')}</span>
      <span role="columnheader">{t('publicApp.home.colEvents')}</span>
      <span role="columnheader">{t('publicApp.home.colGroups')}</span>
      <span role="columnheader" aria-hidden="true">
        {' '}
      </span>
      <span role="columnheader" aria-hidden="true">
        {' '}
      </span>
    </div>
  );
}

function SectionHeader({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {title}
      </h2>
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{count}</span>
    </div>
  );
}

function LeaguesEmpty() {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
      {t('publicApp.home.leaguesEmptyDescription')}
    </div>
  );
}

export function PublicLeaguesSections({ leagues }: { leagues: PublicLeague[] }) {
  const { t } = useI18n();

  if (leagues.length === 0) {
    return <LeaguesEmpty />;
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
        {active.length > 0 ? (
          <div role="table" aria-labelledby="public-leagues-active-title">
            <LeagueTableHeader />
            <div className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-border">
              {active.map((league) => (
                <LeagueRow key={league.slug ?? league.id} league={league} variant="active" />
              ))}
            </div>
          </div>
        ) : (
          <LeaguesEmpty />
        )}
      </section>

      <section aria-labelledby="public-leagues-past-title" className="flex flex-col gap-3">
        <SectionHeader
          id="public-leagues-past-title"
          title={t('publicApp.home.sectionPastLeagues')}
          count={past.length}
        />
        {past.length > 0 ? (
          <div role="table" aria-labelledby="public-leagues-past-title">
            <LeagueTableHeader />
            <div className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-border">
              {past.map((league) => (
                <LeagueRow key={league.slug ?? league.id} league={league} variant="past" />
              ))}
            </div>
          </div>
        ) : (
          <LeaguesEmpty />
        )}
      </section>

      <div className="text-right">
        <Link
          href="/leagues"
          className="text-sm font-semibold text-accent transition-colors hover:text-accent-hover"
        >
          {t('publicApp.home.allLeaguesLink')} →
        </Link>
      </div>
    </div>
  );
}
