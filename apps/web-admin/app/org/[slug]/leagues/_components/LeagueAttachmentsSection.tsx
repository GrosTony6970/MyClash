'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm, statusPillTone, reviewStatusSemantic } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

interface OrgTournament {
  id: string;
  name: string;
  weapon: string | null;
  event_id: string;
  event_name: string | null;
}

interface LeagueGroup {
  id: string;
  name: string;
}

/**
 * One row from `GET /organizations/:orgId/league-attachments?leagueId=` — this
 * org's non-removed tournament→league links for a single league. Carries
 * tournaments.event_id so the withdraw/leave action can hit the event-scoped
 * self-detach route.
 */
interface Attachment {
  id: string;
  league_id: string;
  tournament_id: string;
  status: 'requested' | 'approved' | 'rejected';
  league_groups: { id: string; name: string } | null;
  tournaments: {
    id: string;
    name: string;
    event_id: string;
    events: { id: string; name: string } | null;
  } | null;
}

interface Props {
  orgId: string;
  leagueId: string;
}

/**
 * The "Tournaments attached to this league" nested section for the org Leagues
 * hub. Collapsed by default; on first expand it lazily loads this org's
 * tournaments (across all its events) + this league's existing attachments, so
 * the organizer can attach a tournament or withdraw/leave one — the flow that
 * used to live on the standalone event-scoped leagues page.
 */
export function LeagueAttachmentsSection({ orgId, leagueId }: Props) {
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tournaments, setTournaments] = useState<OrgTournament[]>([]);
  const [groups, setGroups] = useState<LeagueGroup[]>([]);
  const [tournamentId, setTournamentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyDetach, setBusyDetach] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    const r = await apiRequest<Attachment[]>(
      apiUrl,
      `/api/v1/organizations/${orgId}/league-attachments?leagueId=${leagueId}`,
    );
    // Silent on a refusal, as before: this runs after an attach or a leave the
    // operator already got an answer for, and the list keeps what it had.
    if (r.ok) setAttachments(r.data);
  }, [orgId, leagueId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, gRes] = await Promise.all([
        apiRequest<OrgTournament[]>(apiUrl, `/api/v1/organizations/${orgId}/tournaments`),
        apiRequest<LeagueGroup[]>(apiUrl, `/api/v1/leagues/${leagueId}/groups`),
      ]);
      const tData = tRes.ok ? tRes.data : [];
      const gData = gRes.ok ? gRes.data : [];
      setTournaments(tData);
      setGroups(gData);
      setTournamentId(tData[0]?.id ?? '');
      setGroupId(gData[0]?.id ?? '');
      await loadAttachments();
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [orgId, leagueId, loadAttachments]);

  useEffect(() => {
    if (!expanded || loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy fetch when the section is first expanded
    void loadAll();
  }, [expanded, loaded, loadAll]);

  // A requested/approved link blocks re-submitting that tournament to this
  // league; rejected rows do not (removed rows are filtered server-side).
  const blockedByTournament = useMemo(() => {
    const map = new Map<string, 'requested' | 'approved'>();
    for (const a of attachments) {
      if (a.status === 'requested' || a.status === 'approved') map.set(a.tournament_id, a.status);
    }
    return map;
  }, [attachments]);

  const submitBlocked = blockedByTournament.has(tournamentId);

  // Group the picker by event so tournaments from different events are legible.
  const groupedTournaments = useMemo(() => {
    const byEvent = new Map<string, OrgTournament[]>();
    for (const tr of tournaments) {
      const key = tr.event_name ?? '—';
      const arr = byEvent.get(key) ?? [];
      arr.push(tr);
      byEvent.set(key, arr);
    }
    return Array.from(byEvent.entries());
  }, [tournaments]);

  async function submit() {
    if (!tournamentId) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await apiRequest(
        apiUrl,
        `/api/v1/admin/leagues/${leagueId}/tournaments/${tournamentId}/request`,
        { method: 'POST', body: { groupId: groupId || null } },
      );
      if (!r.ok) {
        // The API says which league or tournament refused, and why. This used
        // to `throw new Error()` with no message at all and print "Could not
        // send the request." over the top of it.
        const message = failureMessage(r, t, t('organizer.leagues.attach.error'));
        if (message) setMessage(message);
        return;
      }
      setMessage(t('organizer.leagues.attach.sent'));
      await loadAttachments();
    } finally {
      setBusy(false);
    }
  }

  async function detach(a: Attachment) {
    const eventId = a.tournaments?.event_id;
    if (!eventId) return;
    if (!(await confirm({ title: t('organizer.leagues.attachments.leaveConfirm'), danger: true })))
      return;
    setBusyDetach(a.id);
    try {
      const r = await apiRequest(
        apiUrl,
        `/api/v1/admin/events/${eventId}/league-tournament-links/${a.id}`,
        { method: 'PATCH' },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('organizer.leagues.attachments.detachError'));
        if (message) setMessage(message);
        return;
      }
      await loadAttachments();
    } finally {
      setBusyDetach(null);
    }
  }

  const statusLabel = (status: Attachment['status']) =>
    status === 'requested'
      ? t('organizer.leagues.attachments.statusPending')
      : status === 'approved'
        ? t('organizer.leagues.attachments.statusApproved')
        : t('organizer.leagues.attachments.statusRejected');

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="text-xs font-semibold text-accent hover:underline"
      >
        {expanded
          ? t('organizer.leagues.attachments.collapse')
          : t('organizer.leagues.attachments.expand')}
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {loading && <p className="text-sm text-muted">{t('organizer.leagues.loadingState')}</p>}

          {!loading && attachments.length === 0 && (
            <p className="text-sm text-muted">{t('organizer.leagues.attachments.empty')}</p>
          )}
          {attachments.length > 0 && (
            <ul className="space-y-2">
              {attachments.map((a) => {
                const canDetach = a.status === 'requested' || a.status === 'approved';
                return (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {a.tournaments?.name ?? '—'}
                        {a.tournaments?.events?.name && (
                          <span className="text-xs text-muted"> · {a.tournaments.events.name}</span>
                        )}
                      </p>
                      {a.league_groups?.name && (
                        <p className="text-xs text-muted">
                          {t('organizer.leagues.attachments.groupLabel')}: {a.league_groups.name}
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
                            ? t('organizer.leagues.attachments.withdraw')
                            : t('organizer.leagues.attachments.leave')}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && tournaments.length === 0 ? (
            <p className="text-xs text-muted">{t('organizer.leagues.attach.noTournaments')}</p>
          ) : (
            !loading && (
              <div className="rounded-md border border-border bg-background p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  {t('organizer.leagues.attach.heading')}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1 text-xs text-muted">
                    {t('organizer.leagues.attach.tournamentLabel')}
                    <select
                      value={tournamentId}
                      onChange={(e) => setTournamentId(e.target.value)}
                      className="mt-1 w-full rounded border border-border px-2 py-1 text-sm text-foreground"
                    >
                      {groupedTournaments.map(([eventName, list]) => (
                        <optgroup key={eventName} label={eventName}>
                          {list.map((tr) => {
                            const blocked = blockedByTournament.get(tr.id);
                            const suffix =
                              blocked === 'requested'
                                ? ` ${t('organizer.leagues.attach.alreadyRequested')}`
                                : blocked === 'approved'
                                  ? ` ${t('organizer.leagues.attach.alreadyAttached')}`
                                  : '';
                            return (
                              <option key={tr.id} value={tr.id}>
                                {tr.name}
                                {tr.weapon ? ` (${tr.weapon})` : ''}
                                {suffix}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  {groups.length > 0 && (
                    <label className="flex-1 text-xs text-muted">
                      {t('organizer.leagues.attach.groupLabel')}
                      <select
                        value={groupId}
                        onChange={(e) => setGroupId(e.target.value)}
                        className="mt-1 w-full rounded border border-border px-2 py-1 text-sm text-foreground"
                      >
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy || submitBlocked || !tournamentId}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
                  >
                    {t('organizer.leagues.attach.submit')}
                  </button>
                </div>
                {submitBlocked && (
                  <p className="mt-2 text-xs text-muted">
                    {blockedByTournament.get(tournamentId) === 'requested'
                      ? t('organizer.leagues.attach.alreadyRequested')
                      : t('organizer.leagues.attach.alreadyAttached')}
                  </p>
                )}
                {message && <p className="mt-2 text-xs text-foreground-secondary">{message}</p>}
              </div>
            )
          )}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
