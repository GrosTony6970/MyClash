'use client';

/**
 * Super-admin queue for global-person claim requests submitted from
 * /me when the target profile has no email on file (the §8 fallback
 * to the §3 magic-link confirm path).
 */

import { useCallback, useEffect, useState } from 'react';
import { DataTable, DataTableCell, DataTableHead, DataTableRow } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

interface GlobalPersonPreview {
  id: string;
  displayName: string;
  givenName: string;
  familyName: string;
  countryCode: string | null;
  hemaRatingsId: string | null;
  clubLabel: string | null;
}

interface PendingRequest {
  id: string;
  userId: string;
  requesterEmail: string | null;
  requestedAt: string;
  globalPerson: GlobalPersonPreview | null;
}

export default function PendingClaimsPage() {
  const { t } = useI18n();
  const apiUrl = getPublicApiUrl();
  const [rows, setRows] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiRequest<PendingRequest[]>(
        apiUrl,
        '/api/v1/admin/global-person-claim-requests',
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.loadPendingClaimsFailed'));
        if (message) setError(message);
        return;
      }
      setRows(r.data);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount; state set after await, not synchronously
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const r = await apiRequest(
        apiUrl,
        `/api/v1/admin/global-person-claim-requests/${id}/approve`,
        { method: 'POST' },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.approvalFailed'));
        if (message) setError(message);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      setError(t('admin.common.enterRejectionReason'));
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const r = await apiRequest(
        apiUrl,
        `/api/v1/admin/global-person-claim-requests/${id}/reject`,
        { method: 'POST', body: { reason: rejectReason.trim() } },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.rejectionFailed'));
        if (message) setError(message);
        return;
      }
      setRejectingId(null);
      setRejectReason('');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="p-8 max-w-[110rem]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl mb-1">
            {t('admin.pendingClaims.title')}
          </h1>
          <p className="text-muted text-sm">
            {t('admin.pendingClaims.subtitlePrefix')} <code>claimed_by_user_id</code>{' '}
            {t('admin.pendingClaims.subtitleSuffix')}
          </p>
        </div>
        <BackLink
          href="/admin/global-persons/import"
          label={t('admin.pendingClaims.backToGlobalPersons')}
        />
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('admin.pendingClaims.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.pendingClaims.empty')}</p>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{t('admin.pendingClaims.colRequester')}</DataTableCell>
            <DataTableCell as="th">{t('admin.pendingClaims.colProfile')}</DataTableCell>
            <DataTableCell as="th">{t('admin.pendingClaims.colClub')}</DataTableCell>
            <DataTableCell as="th">{t('admin.pendingClaims.colRequested')}</DataTableCell>
            <DataTableCell as="th" className="text-right">
              {t('admin.pendingClaims.colAction')}
            </DataTableCell>
          </DataTableHead>
          <tbody>
            {rows.map((row) => (
              <DataTableRow key={row.id}>
                <DataTableCell>
                  <div className="font-mono text-xs text-foreground-secondary">
                    {row.requesterEmail ?? row.userId}
                  </div>
                </DataTableCell>
                <DataTableCell>
                  {row.globalPerson ? (
                    <div>
                      <div className="font-semibold">{row.globalPerson.displayName}</div>
                      <div className="text-xs text-muted">
                        {[
                          row.globalPerson.countryCode,
                          row.globalPerson.hemaRatingsId
                            ? t('admin.pendingClaims.hemaIdShort', {
                                id: row.globalPerson.hemaRatingsId,
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted italic">
                      {t('admin.pendingClaims.missingProfile')}
                    </span>
                  )}
                </DataTableCell>
                <DataTableCell className="text-xs text-foreground-secondary">
                  {row.globalPerson?.clubLabel ?? '—'}
                </DataTableCell>
                <DataTableCell className="text-xs text-muted">
                  {new Date(row.requestedAt).toLocaleString()}
                </DataTableCell>
                <DataTableCell className="text-right">
                  {rejectingId === row.id ? (
                    <div className="flex flex-col gap-2 items-end">
                      <input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder={t('admin.pendingClaims.rejectReasonPlaceholder')}
                        className="w-56 border border-border rounded px-2 py-1 text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void reject(row.id)}
                          disabled={busyId === row.id || !rejectReason.trim()}
                          className="rounded bg-danger hover:bg-danger-hover disabled:opacity-50 text-danger-foreground text-xs font-bold px-3 py-1"
                        >
                          {t('admin.pendingClaims.confirmReject')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason('');
                          }}
                          className="rounded border border-border text-xs px-3 py-1"
                        >
                          {t('admin.pendingClaims.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => void approve(row.id)}
                        disabled={busyId === row.id}
                        className="rounded bg-success hover:bg-success-hover disabled:opacity-50 text-success-foreground text-xs font-bold px-3 py-1"
                      >
                        {t('admin.pendingClaims.approve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingId(row.id)}
                        disabled={busyId === row.id}
                        className="rounded border border-border text-foreground-secondary text-xs font-bold px-3 py-1 hover:bg-background"
                      >
                        {t('admin.pendingClaims.reject')}
                      </button>
                    </div>
                  )}
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </main>
  );
}
