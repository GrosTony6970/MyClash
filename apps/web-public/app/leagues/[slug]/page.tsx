import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accentClassFor } from '@myclash/ui';
import { getServerApiUrl, getPublicApiUrl } from '@/lib/api-url';
import { getServerT } from '@/i18n/server-locale';
import {
  StandingsGroups,
  type LeagueStandingRow,
  type LeagueStandingsColumn,
} from './StandingsGroups';
import {
  ClubStandingsSection,
  type ClubStandingRow,
  type UnaffiliatedBucket,
} from './ClubStandingsSection';

interface League {
  id: string;
  name: string;
  season_year: number;
  description: string | null;
  logo_url: string | null;
  // Set once a season is finalized (migration 0155). Optional so the page keeps
  // working against an API that predates the column.
  finalized_at?: string | null;
}

interface Standings {
  league: League;
  columns: LeagueStandingsColumn[];
  rows: LeagueStandingRow[];
  pendingTournaments?: Array<{ tournamentId: string; name: string; eventName: string }>;
}

async function fetchLeague(apiUrl: string, slug: string): Promise<League | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/leagues/${slug}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as League;
  } catch {
    return null;
  }
}

async function fetchStandings(apiUrl: string, leagueId: string): Promise<Standings | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/leagues/${leagueId}/standings`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Standings;
  } catch {
    return null;
  }
}

interface ClubStandings {
  clubs: ClubStandingRow[];
  unaffiliated: UnaffiliatedBucket | null;
}

async function fetchClubStandings(apiUrl: string, leagueId: string): Promise<ClubStandings | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/leagues/${leagueId}/club-standings`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as ClubStandings;
  } catch {
    return null;
  }
}

interface MemberEvent {
  id: string;
  name: string;
  slug: string;
  startDate: string;
  endDate: string | null;
  organization: { id: string; name: string };
}

async function fetchMemberEvents(apiUrl: string, leagueId: string): Promise<MemberEvent[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/leagues/${leagueId}/member-events`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as MemberEvent[];
  } catch {
    return [];
  }
}

function initialsFor(name: string | null | undefined): string {
  const value = (name ?? '').trim();
  if (!value) return '··';
  const parts = value.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

export default async function PublicLeagueStandingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getServerT();
  const apiUrl = getServerApiUrl();
  const league = await fetchLeague(apiUrl, slug);
  if (!league) notFound();
  const [standings, clubStandings, memberEvents] = await Promise.all([
    fetchStandings(apiUrl, league.id),
    fetchClubStandings(apiUrl, league.id),
    fetchMemberEvents(apiUrl, league.id),
  ]);
  const columns = standings?.columns ?? [];
  const rows = standings?.rows ?? [];
  const clubs = clubStandings?.clubs ?? [];
  const unaffiliated = clubStandings?.unaffiliated ?? null;
  const pendingTournaments = standings?.pendingTournaments ?? [];
  const isFinalized = Boolean(standings?.league?.finalized_at ?? league.finalized_at);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <Link
        href="/"
        className="inline-flex items-center text-sm font-semibold text-accent hover:text-accent-hover"
      >
        ← {t('publicApp.leagues.backToHome')}
      </Link>

      <section className="flex flex-col gap-4 border-y border-border py-6 sm:flex-row sm:items-start sm:py-8">
        {league.logo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={league.logo_url}
            alt=""
            className="h-20 w-20 shrink-0 rounded-xl border border-border bg-surface object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-base font-semibold text-muted">
            {initialsFor(league.name)}
          </div>
        )}
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
              {league.name}
            </h1>
            {isFinalized && (
              <span
                className={[
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm',
                  accentClassFor('gold'),
                ].join(' ')}
              >
                {t('publicApp.leagues.seasonFinalized')}
              </span>
            )}
          </div>
          {league.season_year != null && (
            <p className="text-sm tabular-nums text-muted">{league.season_year}</p>
          )}
          {league.description && (
            <p className="mt-2 max-w-prose text-sm leading-6 text-foreground-secondary">
              {league.description}
            </p>
          )}
          {isFinalized && (
            <p className="mt-2 text-sm text-foreground-secondary">
              {t('publicApp.leagues.seasonFinalizedNote')}
            </p>
          )}
          {rows.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-4 text-sm">
              {/* getPublicApiUrl: these hrefs land in HTML — the SSR-side
                  getServerApiUrl() would leak the docker-internal host here. */}
              <a
                href={`${getPublicApiUrl()}/api/v1/leagues/${league.id}/final-report.csv`}
                className="font-semibold text-accent hover:text-accent-hover"
              >
                {t('publicApp.leagues.downloadReport')}
              </a>
              <a
                href={`${getPublicApiUrl()}/api/v1/leagues/${league.id}/final-report.print.html`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent hover:text-accent-hover"
              >
                {t('publicApp.leagues.printableReport')}
              </a>
            </p>
          )}
        </div>
      </section>

      {memberEvents.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.leagues.memberEventsTitle')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {memberEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/e/${event.slug}`}
                  className="inline-flex flex-col rounded-lg border border-border bg-surface px-4 py-2 shadow-sm transition-colors hover:border-accent"
                >
                  <span className="text-sm font-semibold text-foreground">{event.name}</span>
                  <span className="text-xs text-muted">{event.organization.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingTournaments.length > 0 && (
        <p className="rounded-lg border border-dashed border-border bg-background px-4 py-3 text-sm text-muted">
          {t('publicApp.leagues.pendingNote', { count: pendingTournaments.length })}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
          {t('publicApp.leagues.empty')}
        </div>
      ) : (
        <>
          <StandingsGroups rows={rows} columns={columns} />
          <ClubStandingsSection clubs={clubs} unaffiliated={unaffiliated} />
        </>
      )}
    </main>
  );
}
