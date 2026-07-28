'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm, statusPillTone, reviewStatusSemantic } from '@myclash/ui';
import { useI18n } from '../../../../../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

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
}

/**
 * Focused in-event affordance for attaching THIS event's tournaments to a
 * league. The standalone event-scoped leagues page was merged into the org
 * Leagues hub; this collapsible panel preserves the in-context workflow so an
 * organizer setting up an event can still request league attachments without
 * leaving the event workspace. Locale-aware (useI18n) — the retired page used
 * the EN-only static `t`.
 */
export function AttachToLeaguePanel({ eventId }: Props) {
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [leagueId, setLeagueId] = useState('');
  const [tournamentId, setTournamentId] = useState('');
  const [groups, setGroups] = useState<LeagueGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busyDetach, setBusyDetach] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadAttachments = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/league-attachments`, {
        credentials: 'include',
      });
      if (res.ok) setAttachments((await res.json()) as Attachment[]);
    } catch {
      // The panel surfaces submit/detach errors inline; a silent list-load
      // failure just leaves the list empty.
    }
  }, [eventId]);

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
    setLoaded(true);
  }, [eventId, loadAttachments, t]);

  useEffect(() => {
    if (!open || loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy fetch when the panel is first opened
    load();
  }, [open, loaded, load]);

  useEffect(() => {
    if (!leagueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear dependent group selection when no league is chosen
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
  }, [leagueId]);

  const tournamentStatusForLeague = useMemo(() => {
    const map = new Map<string, 'requested' | 'approved'>();
    for (const a of attachments) {
      if (a.league_id !== leagueId) continue;
      if (a.status === 'requested' || a.status === 'approved') map.set(a.tournament_id, a.status);
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
        if (!res.ok) throw new Error();
        setMessage(t('admin.leagues.requestSent'));
        void loadAttachments();
      })
      .catch(() => setMessage(t('admin.leagues.requestError')));
  };

  const detach = async (attachment: Attachment) => {
    if (!(await confirm({ title: t('admin.leagues.myRequests.leaveConfirm'), danger: true })))
      return;
    setBusyDetach(attachment.id);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/events/${eventId}/league-tournament-links/${attachment.id}`,
        { method: 'PATCH', credentials: 'include' },
      );
      if (!res.ok) throw new Error();
      void loadAttachments();
    } catch {
      setMessage(t('admin.leagues.myRequests.detachError'));
    } finally {
      setBusyDetach(null);
    }
  };

  const statusLabel = (status: Attachment['status']) =>
    status === 'requested'
      ? t('admin.leagues.myRequests.statusPending')
      : status === 'approved'
        ? t('admin.leagues.myRequests.statusApproved')
        : t('admin.leagues.myRequests.statusRejected');

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-foreground">
            {t('admin.leagues.requestAttach')}
          </span>
          <span className="block text-xs text-muted">{t('admin.leagues.attachDescription')}</span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-accent">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-6">
          <div className="max-w-xl">
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="attach-league">
              {t('admin.leagues.league')}
            </label>
            <select
              id="attach-league"
              className="mb-3 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
            >
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </select>

            <label
              className="mb-1 block text-xs font-medium text-muted"
              htmlFor="attach-tournament"
            >
              {t('admin.leagues.tournament')}
            </label>
            <select
              id="attach-tournament"
              className="mb-3 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
              value={tournamentId}
              onChange={(e) => setTournamentId(e.target.value)}
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
                <label className="mb-1 block text-xs font-medium text-muted" htmlFor="attach-group">
                  {t('admin.leagues.myRequests.group')}
                </label>
                <select
                  id="attach-group"
                  className="mb-3 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
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
              type="button"
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
              onClick={submit}
              disabled={submitBlocked || !leagueId || !tournamentId}
            >
              {t('admin.leagues.submitRequest')}
            </button>
            {submitBlocked && (
              <p className="mt-2 text-xs text-muted">
                {selectedBlockedStatus === 'requested'
                  ? t('admin.leagues.myRequests.alreadyRequested')
                  : t('admin.leagues.myRequests.alreadyAttached')}
              </p>
            )}
            {message && <p className="mt-3 text-sm text-foreground-secondary">{message}</p>}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              {t('admin.leagues.myRequests.existingTitle')}
            </h3>
            {attachments.length === 0 ? (
              <p className="text-sm text-muted">{t('admin.leagues.myRequests.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {attachments.map((a) => {
                  const canDetach = a.status === 'requested' || a.status === 'approved';
                  return (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {a.tournaments?.name ?? '—'} → {a.leagues?.name ?? '—'}
                        </p>
                        {a.league_groups?.name && (
                          <p className="text-xs text-muted">
                            {t('admin.leagues.myRequests.group')}: {a.league_groups.name}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusPillTone(reviewStatusSemantic(a.status), 'light').className}`}
                        >
                          {statusLabel(a.status)}
                        </span>
                        {canDetach && (
                          <button
                            type="button"
                            onClick={() => void detach(a)}
                            disabled={busyDetach === a.id}
                            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-background disabled:opacity-50"
                          >
                            {a.status === 'requested'
                              ? t('admin.leagues.myRequests.withdraw')
                              : t('admin.leagues.myRequests.leaveLeague')}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
