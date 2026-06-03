'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '@myclash/i18n';

interface League {
  id: string;
  name: string;
}

interface Tournament {
  id: string;
  name: string;
}

interface LeagueGroup {
  id: string;
  name: string;
}

/**
 * One row from `GET /events/:eventId/league-attachments` — every
 * non-removed link the event has to any league. Status drives the
 * Withdraw / Leave league action; (league_id, tournament_id) drives
 * the per-pair Submit dedupe in the form below.
 */
interface Attachment {
  id: string;
  league_id: string;
  tournament_id: string;
  status: 'requested' | 'approved' | 'rejected';
  leagues: { id: string; name: string; season_year?: number | null } | null;
  league_groups: { id: string; name: string } | null;
  tournaments: { id: string; name: string } | null;
}

interface Props {
  eventId: string;
  apiUrl: string;
}

export function RequestsTab({ eventId, apiUrl }: Props) {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [leagueId, setLeagueId] = useState('');
  const [tournamentId, setTournamentId] = useState('');
  const [groups, setGroups] = useState<LeagueGroup[]>([]);
  const [groupId, setGroupId] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  const [busyDetach, setBusyDetach] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/league-attachments`, {
        credentials: 'include',
      });
      if (res.ok) setAttachments((await res.json()) as Attachment[]);
    } catch {
      // Swallow — the page already surfaces a load error via the leagues/tournaments fetches.
    }
  }, [apiUrl, eventId]);

  const load = useCallback(() => {
    void Promise.all([
      fetch(`${apiUrl}/api/v1/leagues/attachable`, { credentials: 'include' }).then(
        (res) => res.json() as Promise<League[]>,
      ),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`).then(
        (res) => res.json() as Promise<Tournament[]>,
      ),
    ])
      .then(([leagueRows, tournamentRows]) => {
        setLeagues(leagueRows);
        setTournaments(tournamentRows);
        setLeagueId(leagueRows[0]?.id ?? '');
        setTournamentId(tournamentRows[0]?.id ?? '');
      })
      .catch(() => setMessage(t('admin.leagues.loadError')));
    void loadAttachments();
  }, [apiUrl, eventId, loadAttachments]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the selected league's groups so the operator can pick which
  // bucket the tournament should land in. Empty groups list = league
  // doesn't define any; submit without a groupId.
  useEffect(() => {
    if (!leagueId) {
      setGroups([]);
      setGroupId('');
      return;
    }
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/leagues/${leagueId}/groups`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<LeagueGroup[]>) : []))
      .then((rows) => {
        setGroups(rows);
        setGroupId(rows[0]?.id ?? '');
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [leagueId, apiUrl]);

  // Per-tournament status against the currently selected league.
  // A `requested` or `approved` link blocks a re-submit; rejected /
  // removed rows (the latter is already filtered server-side) do not.
  const tournamentStatusForLeague = useMemo(() => {
    const map = new Map<string, 'requested' | 'approved'>();
    for (const a of attachments) {
      if (a.league_id !== leagueId) continue;
      if (a.status === 'requested' || a.status === 'approved') {
        map.set(a.tournament_id, a.status);
      }
    }
    return map;
  }, [attachments, leagueId]);

  const submitBlocked = tournamentStatusForLeague.has(tournamentId);
  const selectedBlockedStatus = tournamentStatusForLeague.get(tournamentId);

  const submit = () => {
    setMessage(null);
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournaments/${tournamentId}/request`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: groupId || null }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(t('admin.leagues.requestError'));
        setMessage(t('admin.leagues.requestSent'));
        void loadAttachments();
      })
      .catch(() => setMessage(t('admin.leagues.requestError')));
  };

  const detach = async (attachment: Attachment) => {
    if (!window.confirm(t('admin.leagues.myRequests.leaveConfirm'))) return;
    setBusyDetach(attachment.id);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/events/${eventId}/league-tournament-links/${attachment.id}`,
        { method: 'PATCH', credentials: 'include' },
      );
      if (!res.ok) throw new Error('detach failed');
      // Same backend transition handles both Withdraw (was pending) and Leave league (was approved).
      void loadAttachments();
    } catch {
      setMessage(t('admin.leagues.myRequests.detachError'));
    } finally {
      setBusyDetach(null);
    }
  };

  const statusLabel = (status: Attachment['status']) => {
    if (status === 'requested') return t('admin.leagues.myRequests.statusPending');
    if (status === 'approved') return t('admin.leagues.myRequests.statusApproved');
    return t('admin.leagues.myRequests.statusRejected');
  };

  const statusBadgeClass = (status: Attachment['status']) => {
    if (status === 'requested') return 'bg-amber-100 text-amber-800';
    if (status === 'approved') return 'bg-emerald-100 text-emerald-800';
    return 'bg-rose-100 text-rose-800';
  };

  return (
    <div className="space-y-8">
      <section className="max-w-xl border border-gray-200 rounded-lg p-5">
        <label className="block text-sm font-medium mb-2" htmlFor="league">
          {t('admin.leagues.league')}
        </label>
        <select
          id="league"
          className="border rounded px-3 py-2 text-sm w-full mb-4"
          value={leagueId}
          onChange={(event) => setLeagueId(event.target.value)}
        >
          {leagues.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>

        <label className="block text-sm font-medium mb-2" htmlFor="tournament">
          {t('admin.leagues.tournament')}
        </label>
        <select
          id="tournament"
          className="border rounded px-3 py-2 text-sm w-full mb-4"
          value={tournamentId}
          onChange={(event) => setTournamentId(event.target.value)}
        >
          {tournaments.map((tournament) => {
            const blocked = tournamentStatusForLeague.get(tournament.id);
            const suffix =
              blocked === 'requested'
                ? ` ${t('admin.leagues.myRequests.alreadyRequested')}`
                : blocked === 'approved'
                  ? ` ${t('admin.leagues.myRequests.alreadyAttached')}`
                  : '';
            return (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name}
                {suffix}
              </option>
            );
          })}
        </select>

        {groups.length > 0 && (
          <>
            <label className="block text-sm font-medium mb-2" htmlFor="group">
              {t('admin.leagues.myRequests.group')}
            </label>
            <select
              id="group"
              className="border rounded px-3 py-2 text-sm w-full mb-4"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </>
        )}

        <button
          className="bg-gray-950 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
          onClick={submit}
          disabled={submitBlocked || !leagueId || !tournamentId}
        >
          {t('admin.leagues.submitRequest')}
        </button>
        {submitBlocked && (
          <p className="text-xs text-gray-500 mt-2">
            {selectedBlockedStatus === 'requested'
              ? t('admin.leagues.myRequests.alreadyRequested')
              : t('admin.leagues.myRequests.alreadyAttached')}
          </p>
        )}
        {message && <p className="text-sm text-gray-600 mt-4">{message}</p>}
      </section>

      <section className="max-w-3xl">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          {t('admin.leagues.myRequests.existingTitle')}
        </h2>
        {attachments.length === 0 ? (
          <p className="text-sm text-gray-500">{t('admin.leagues.myRequests.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((a) => {
              const canDetach = a.status === 'requested' || a.status === 'approved';
              const actionLabel =
                a.status === 'requested'
                  ? t('admin.leagues.myRequests.withdraw')
                  : t('admin.leagues.myRequests.leaveLeague');
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {a.tournaments?.name ?? '—'} → {a.leagues?.name ?? '—'}
                    </p>
                    {a.league_groups?.name && (
                      <p className="text-xs text-gray-500">
                        {t('admin.leagues.myRequests.group')}: {a.league_groups.name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(a.status)}`}
                    >
                      {statusLabel(a.status)}
                    </span>
                    {canDetach && (
                      <button
                        type="button"
                        onClick={() => void detach(a)}
                        disabled={busyDetach === a.id}
                        className="text-xs rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {actionLabel}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
