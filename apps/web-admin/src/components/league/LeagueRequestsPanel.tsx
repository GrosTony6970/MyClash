'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '../../lib/api-url';

const apiUrl = getPublicApiUrl();

export interface LeagueTournamentRequest {
  id: string;
  status: 'requested' | 'approved' | 'rejected' | 'removed';
  created_at: string;
  reviewed_at: string | null;
  note?: string | null;
  rejection_reason?: string | null;
  tournaments?: {
    id: string;
    name: string | null;
    weapon: string | null;
    events?: {
      id: string;
      name: string | null;
      organization_id: string | null;
      organizations?: { id: string; name: string | null } | null;
    } | null;
  } | null;
}

export interface LeagueMembershipRequest {
  id: string;
  league_id: string;
  organization_id: string;
  requested_role: string;
  status: 'requested' | 'approved' | 'rejected' | 'withdrawn';
  message: string | null;
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  organizations?: {
    id: string;
    name: string | null;
    slug: string | null;
    logo_url: string | null;
  } | null;
}

interface Props {
  leagueId: string;
  // When true, render in standalone-page chrome; otherwise as a section
  // inside the league editor.
  standalone?: boolean;
  // Optional title override (the standalone route uses the league name).
  title?: string;
}

type Tab = 'tournament_attaches' | 'membership_requests';

export function LeagueRequestsPanel({ leagueId, standalone = false, title }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('tournament_attaches');

  const [tournamentRows, setTournamentRows] = useState<LeagueTournamentRequest[]>([]);
  const [membershipRows, setMembershipRows] = useState<LeagueMembershipRequest[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, mRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/requests?status=requested`, {
          credentials: 'include',
        }),
        fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/membership-requests?status=requested`, {
          credentials: 'include',
        }),
      ]);
      if (!tRes.ok) throw new Error(t('admin.leagues.requestsPanel.loadTournamentError'));
      const tData = (await tRes.json()) as LeagueTournamentRequest[];
      setTournamentRows(tData);
      if (mRes.ok) {
        const mData = (await mRes.json()) as LeagueMembershipRequest[];
        setMembershipRows(mData);
      } else {
        setMembershipRows([]);
      }
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.leagues.requestsPanel.loadGenericError'),
      );
    } finally {
      setLoading(false);
    }
  }, [leagueId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial/keyed data fetch; setState happens async after the awaited request resolves
    void reload();
  }, [reload]);

  async function reviewTournamentLink(linkId: string, status: 'approved' | 'rejected') {
    setBusyId(linkId);
    try {
      const body: Record<string, unknown> = { status };
      if (status === 'rejected' && rejectReason.trim()) {
        body['rejectionReason'] = rejectReason.trim();
      }
      const res = await fetch(`${apiUrl}/api/v1/admin/league-tournament-links/${linkId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          err.message ??
            t(
              status === 'approved'
                ? 'admin.leagues.requestsPanel.approvedFailed'
                : 'admin.leagues.requestsPanel.rejectedFailed',
            ),
        );
      }
      toast.success(
        t(
          status === 'approved'
            ? 'admin.leagues.requestsPanel.approvedToast'
            : 'admin.leagues.requestsPanel.rejectedToast',
        ),
      );
      setRejectingId(null);
      setRejectReason('');
      await reload();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t(
              status === 'approved'
                ? 'admin.leagues.requestsPanel.approvedFailed'
                : 'admin.leagues.requestsPanel.rejectedFailed',
            ),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reviewMembership(reqId: string, status: 'approved' | 'rejected') {
    setBusyId(reqId);
    try {
      const body: Record<string, unknown> = { status };
      if (status === 'rejected' && rejectReason.trim()) {
        body['reviewNote'] = rejectReason.trim();
      }
      const res = await fetch(`${apiUrl}/api/v1/admin/league-membership-requests/${reqId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          err.message ??
            t(
              status === 'approved'
                ? 'admin.leagues.requestsPanel.approvedFailed'
                : 'admin.leagues.requestsPanel.rejectedFailed',
            ),
        );
      }
      toast.success(
        t(
          status === 'approved'
            ? 'admin.leagues.requestsPanel.membershipApprovedToast'
            : 'admin.leagues.requestsPanel.membershipRejectedToast',
        ),
      );
      setRejectingId(null);
      setRejectReason('');
      await reload();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t(
              status === 'approved'
                ? 'admin.leagues.requestsPanel.approvedFailed'
                : 'admin.leagues.requestsPanel.rejectedFailed',
            ),
      );
    } finally {
      setBusyId(null);
    }
  }

  const wrapClass = standalone
    ? 'rounded-lg border border-border bg-surface p-6 shadow-sm'
    : 'rounded-lg border border-border bg-surface p-4 shadow-sm';

  return (
    <section className={wrapClass}>
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {title ?? t('admin.leagues.requestsPanel.defaultTitle')}
          </h2>
          <p className="text-xs text-muted">{t('admin.leagues.requestsPanel.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground-secondary hover:bg-background"
        >
          {t('admin.leagues.requestsPanel.refreshButton')}
        </button>
      </header>

      <div className="mb-3 flex gap-1 border-b border-border text-sm">
        <button
          type="button"
          onClick={() => setTab('tournament_attaches')}
          className={[
            'px-3 py-2 -mb-px border-b-2 font-medium',
            tab === 'tournament_attaches'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted hover:text-foreground-secondary',
          ].join(' ')}
        >
          {t('admin.leagues.requestsPanel.tabTournament')}{' '}
          <span className="ml-1 rounded bg-background px-1.5 py-0.5 text-[11px] text-foreground-secondary">
            {tournamentRows.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('membership_requests')}
          className={[
            'px-3 py-2 -mb-px border-b-2 font-medium',
            tab === 'membership_requests'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted hover:text-foreground-secondary',
          ].join(' ')}
        >
          {t('admin.leagues.requestsPanel.tabMembership')}{' '}
          <span className="ml-1 rounded bg-background px-1.5 py-0.5 text-[11px] text-foreground-secondary">
            {membershipRows.length}
          </span>
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {tab === 'tournament_attaches' ? (
        <>
          {loading && (
            <p className="py-4 text-sm text-muted">
              {t('admin.leagues.requestsPanel.loadingState')}
            </p>
          )}
          {!loading && tournamentRows.length === 0 && (
            <p className="py-4 text-sm text-muted">
              {t('admin.leagues.requestsPanel.emptyTournament')}
            </p>
          )}
          <ul className="space-y-2">
            {tournamentRows.map((row) => {
              const tournament = row.tournaments;
              const event = tournament?.events;
              const org = event?.organizations;
              const isRejecting = rejectingId === row.id;
              return (
                <li
                  key={row.id}
                  className="rounded border border-border bg-background px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {tournament?.name ?? t('admin.leagues.requestsPanel.tournamentFallback')}
                        {tournament?.weapon && (
                          <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[11px] font-mono text-foreground-secondary">
                            {tournament.weapon}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {event?.name ?? t('admin.leagues.requestsPanel.eventFallback')}
                        {org?.name && (
                          <>
                            {' · '}
                            {t('admin.leagues.requestsPanel.requestedBy', { name: org.name })}
                          </>
                        )}
                      </p>
                      {row.note && (
                        <p className="mt-1 text-xs italic text-foreground-secondary">
                          "{row.note}"
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void reviewTournamentLink(row.id, 'approved')}
                        disabled={busyId === row.id || isRejecting}
                        className="rounded-md bg-success px-3 py-1 text-xs font-semibold text-success-foreground hover:bg-success-hover disabled:opacity-50"
                      >
                        {t('admin.leagues.requestsPanel.acceptButton')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(row.id);
                          setRejectReason('');
                        }}
                        disabled={busyId === row.id || isRejecting}
                        className="rounded-md border border-danger px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                      >
                        {t('admin.leagues.requestsPanel.refuseButton')}
                      </button>
                    </div>
                  </div>
                  {isRejecting && (
                    <RejectInline
                      busy={busyId === row.id}
                      reason={rejectReason}
                      setReason={setRejectReason}
                      onConfirm={() => void reviewTournamentLink(row.id, 'rejected')}
                      onCancel={() => {
                        setRejectingId(null);
                        setRejectReason('');
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          {loading && (
            <p className="py-4 text-sm text-muted">
              {t('admin.leagues.requestsPanel.loadingState')}
            </p>
          )}
          {!loading && membershipRows.length === 0 && (
            <p className="py-4 text-sm text-muted">
              {t('admin.leagues.requestsPanel.emptyMembership')}
            </p>
          )}
          <ul className="space-y-2">
            {membershipRows.map((row) => {
              const isRejecting = rejectingId === row.id;
              return (
                <li
                  key={row.id}
                  className="rounded border border-border bg-background px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {row.organizations?.name ?? t('admin.leagues.requestsPanel.orgFallback')}
                        <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[11px] font-mono text-foreground-secondary">
                          {row.requested_role}
                        </span>
                      </p>
                      <p className="text-xs text-muted">
                        {t('admin.leagues.requestsPanel.submittedAt', {
                          date: new Date(row.requested_at).toLocaleString(),
                        })}
                      </p>
                      {row.message && (
                        <p className="mt-1 text-xs italic text-foreground-secondary">
                          "{row.message}"
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void reviewMembership(row.id, 'approved')}
                        disabled={busyId === row.id || isRejecting}
                        className="rounded-md bg-success px-3 py-1 text-xs font-semibold text-success-foreground hover:bg-success-hover disabled:opacity-50"
                      >
                        {t('admin.leagues.requestsPanel.acceptButton')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(row.id);
                          setRejectReason('');
                        }}
                        disabled={busyId === row.id || isRejecting}
                        className="rounded-md border border-danger px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                      >
                        {t('admin.leagues.requestsPanel.refuseButton')}
                      </button>
                    </div>
                  </div>
                  {isRejecting && (
                    <RejectInline
                      busy={busyId === row.id}
                      reason={rejectReason}
                      setReason={setRejectReason}
                      onConfirm={() => void reviewMembership(row.id, 'rejected')}
                      onCancel={() => {
                        setRejectingId(null);
                        setRejectReason('');
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

interface RejectInlineProps {
  busy: boolean;
  reason: string;
  setReason: (s: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function RejectInline({ busy, reason, setReason, onConfirm, onCancel }: RejectInlineProps) {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('admin.leagues.requestsPanel.reasonPlaceholder')}
        className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: inline reason field appears on demand, focus should move to it immediately
        autoFocus
      />
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="rounded-md bg-danger px-3 py-1 text-xs font-semibold text-danger-foreground hover:bg-danger-hover disabled:opacity-50"
      >
        {t('admin.leagues.requestsPanel.confirmRefuseButton')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-border px-3 py-1 text-xs text-foreground-secondary hover:bg-background"
      >
        {t('admin.leagues.requestsPanel.cancelButton')}
      </button>
    </div>
  );
}
