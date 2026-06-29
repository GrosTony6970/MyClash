'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '@myclash/i18n';

interface Attachment {
  id: string;
  league_id: string;
  tournament_id: string;
  status: 'requested' | 'approved' | 'rejected';
  leagues: {
    id: string;
    name: string;
    slug: string;
    season_year: number | null;
    scoring_system: string | null;
  } | null;
  league_groups: { id: string; name: string } | null;
  tournaments: { id: string; name: string } | null;
}

interface SiblingEvent {
  id: string;
  name: string;
  slug: string;
  startDate: string;
  endDate: string | null;
  organization: { id: string; name: string };
}

interface LeagueCard {
  leagueId: string;
  leagueName: string;
  seasonYear: number | null;
  scoringSystem: string | null;
  tournaments: Array<{
    tournamentId: string;
    tournamentName: string;
    groupName: string | null;
  }>;
}

interface Props {
  eventId: string;
  apiUrl: string;
}

const publicAppUrl = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';

function formatDateRange(startIso: string, endIso: string | null): string {
  const start = new Date(`${startIso}T00:00:00Z`);
  const startStr = Number.isNaN(start.getTime())
    ? startIso
    : start.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  if (!endIso || endIso === startIso) return startStr;
  const end = new Date(`${endIso}T00:00:00Z`);
  const endStr = Number.isNaN(end.getTime())
    ? endIso
    : end.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return `${startStr} – ${endStr}`;
}

export function MembershipsTab({ eventId, apiUrl }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [siblingsByLeague, setSiblingsByLeague] = useState<Map<string, SiblingEvent[]>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [siblingsError, setSiblingsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/league-attachments`, {
        credentials: 'include',
      });
      if (res.ok) setAttachments((await res.json()) as Attachment[]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() drives an async fetch on mount; behaviour-preserving
    void load();
  }, [load]);

  // Group approved attachments into one card per league. Multiple
  // tournaments from this event can land in the same league (different
  // groups), so we accumulate them under the league card.
  const cards = useMemo<LeagueCard[]>(() => {
    const byLeague = new Map<string, LeagueCard>();
    for (const a of attachments) {
      if (a.status !== 'approved' || !a.leagues) continue;
      const existing = byLeague.get(a.league_id);
      const tournamentEntry = {
        tournamentId: a.tournament_id,
        tournamentName: a.tournaments?.name ?? '—',
        groupName: a.league_groups?.name ?? null,
      };
      if (existing) {
        // Dedupe (one row per (league, tournament) — the backend
        // already enforces this via the unique index, but be safe).
        if (!existing.tournaments.some((x) => x.tournamentId === tournamentEntry.tournamentId)) {
          existing.tournaments.push(tournamentEntry);
        }
      } else {
        byLeague.set(a.league_id, {
          leagueId: a.league_id,
          leagueName: a.leagues.name,
          seasonYear: a.leagues.season_year,
          scoringSystem: a.leagues.scoring_system,
          tournaments: [tournamentEntry],
        });
      }
    }
    return Array.from(byLeague.values());
  }, [attachments]);

  // Fetch sibling events per league card. Parallel fetches keyed by
  // league id; any 404 / error becomes an empty list for that league.
  useEffect(() => {
    if (cards.length === 0) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset error before an async sibling-load; behaviour-preserving
    setSiblingsError(null);
    void Promise.all(
      cards.map(async (card) => {
        try {
          const res = await fetch(`${apiUrl}/api/v1/leagues/${card.leagueId}/member-events`, {
            credentials: 'include',
          });
          if (!res.ok) return [card.leagueId, [] as SiblingEvent[]] as const;
          const events = (await res.json()) as SiblingEvent[];
          // Filter out THIS event — operator already knows they're in.
          const filtered = events.filter((e) => e.id !== eventId);
          return [card.leagueId, filtered] as const;
        } catch {
          return [card.leagueId, [] as SiblingEvent[]] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map = new Map<string, SiblingEvent[]>();
      let anyError = false;
      for (const [leagueId, list] of entries) {
        map.set(leagueId, list);
        if (list.length === 0) anyError = false; // don't flag empties as errors
      }
      setSiblingsByLeague(map);
      if (anyError) setSiblingsError(t('admin.leagues.memberships.siblingsError'));
    });
    return () => {
      cancelled = true;
    };
  }, [cards, apiUrl, eventId]);

  if (loading) {
    return <p className="text-sm text-muted">{t('admin.leagues.loading')}</p>;
  }

  if (cards.length === 0) {
    return <p className="text-sm text-muted">{t('admin.leagues.memberships.empty')}</p>;
  }

  return (
    <div className="space-y-4">
      {siblingsError && <p className="text-xs text-warning">{siblingsError}</p>}
      {cards.map((card) => {
        const siblings = siblingsByLeague.get(card.leagueId) ?? [];
        return (
          <article
            key={card.leagueId}
            className="rounded-lg border border-border bg-surface p-5 max-w-3xl"
          >
            <header className="mb-3">
              <h3 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                {card.leagueName}
              </h3>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {card.seasonYear !== null && (
                  <span>
                    {t('admin.leagues.memberships.year')}: {card.seasonYear}
                  </span>
                )}
                {card.scoringSystem && (
                  <span>
                    {t('admin.leagues.memberships.scoringSystem')}: {card.scoringSystem}
                  </span>
                )}
              </div>
            </header>

            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
                {t('admin.leagues.memberships.yourTournaments')}
              </p>
              <ul className="space-y-1 text-sm">
                {card.tournaments.map((tx) => (
                  <li key={tx.tournamentId} className="text-foreground">
                    {tx.tournamentName}
                    <span className="text-xs text-muted">
                      {' '}
                      ·{' '}
                      {tx.groupName
                        ? `${t('admin.leagues.memberships.group')}: ${tx.groupName}`
                        : t('admin.leagues.memberships.noGroup')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
                {t('admin.leagues.memberships.otherEvents')}
              </p>
              {siblings.length === 0 ? (
                <p className="text-sm text-muted">
                  {t('admin.leagues.memberships.otherEventsEmpty')}
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {siblings.map((event) => (
                    <li key={event.id}>
                      <a
                        href={`${publicAppUrl}/e/${event.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-info hover:underline"
                      >
                        {event.name}
                      </a>{' '}
                      <span className="text-xs text-muted">
                        · {formatDateRange(event.startDate, event.endDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
