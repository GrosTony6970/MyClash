'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@myclash/ui';
import { useI18n } from '../../i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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
    ? 'rounded-lg border border-slate-200 bg-white p-6 shadow-sm'
    : 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm';

  return (
    <section className={wrapClass}>
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {title ?? t('admin.leagues.requestsPanel.defaultTitle')}
          </h2>
          <p className="text-xs text-slate-500">{t('admin.leagues.requestsPanel.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('admin.leagues.requestsPanel.refreshButton')}
        </button>
      </header>

      <div className="mb-3 flex gap-1 border-b border-slate-200 text-sm">
        <button
          type="button"
          onClick={() => setTab('tournament_attaches')}
          className={[
            'px-3 py-2 -mb-px border-b-2 font-medium',
            tab === 'tournament_attaches'
              ? 'border-red-700 text-red-700'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          ].join(' ')}
        >
          {t('admin.leagues.requestsPanel.tabTournament')}{' '}
          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
            {tournamentRows.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('membership_requests')}
          className={[
            'px-3 py-2 -mb-px border-b-2 font-medium',
            tab === 'membership_requests'
              ? 'border-red-700 text-red-700'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          ].join(' ')}
        >
          {t('admin.leagues.requestsPanel.tabMembership')}{' '}
          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
            {membershipRows.length}
          </span>
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {tab === 'tournament_attaches' ? (
        <>
          {loading && (
            <p className="py-4 text-sm text-slate-400">
              {t('admin.leagues.requestsPanel.loadingState')}
            </p>
          )}
          {!loading && tournamentRows.length === 0 && (
            <p className="py-4 text-sm text-slate-500">
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
                  className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">
                        {tournament?.name ?? t('admin.leagues.requestsPanel.tournamentFallback')}
                        {tournament?.weapon && (
                          <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-mono text-slate-600">
                            {tournament.weapon}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {event?.name ?? t('admin.leagues.requestsPanel.eventFallback')}
                        {org?.name && (
                          <>
                            {' · '}
                            {t('admin.leagues.requestsPanel.requestedBy', { name: org.name })}
                          </>
                        )}
                      </p>
                      {row.note && (
                        <p className="mt-1 text-xs italic text-slate-600">"{row.note}"</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void reviewTournamentLink(row.id, 'approved')}
                        disabled={busyId === row.id || isRejecting}
                        className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
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
                        className="rounded-md border border-red-700 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
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
            <p className="py-4 text-sm text-slate-400">
              {t('admin.leagues.requestsPanel.loadingState')}
            </p>
          )}
          {!loading && membershipRows.length === 0 && (
            <p className="py-4 text-sm text-slate-500">
              {t('admin.leagues.requestsPanel.emptyMembership')}
            </p>
          )}
          <ul className="space-y-2">
            {membershipRows.map((row) => {
              const isRejecting = rejectingId === row.id;
              return (
                <li
                  key={row.id}
                  className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">
                        {row.organizations?.name ?? t('admin.leagues.requestsPanel.orgFallback')}
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-mono text-slate-600">
                          {row.requested_role}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {t('admin.leagues.requestsPanel.submittedAt', {
                          date: new Date(row.requested_at).toLocaleString(),
                        })}
                      </p>
                      {row.message && (
                        <p className="mt-1 text-xs italic text-slate-600">"{row.message}"</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void reviewMembership(row.id, 'approved')}
                        disabled={busyId === row.id || isRejecting}
                        className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
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
                        className="rounded-md border border-red-700 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
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
        className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
        autoFocus
      />
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="rounded-md bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
      >
        {t('admin.leagues.requestsPanel.confirmRefuseButton')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
      >
        {t('admin.leagues.requestsPanel.cancelButton')}
      </button>
    </div>
  );
}
