'use client';

import { useState } from 'react';
import { t } from '@myclash/i18n';
import type { ReviewQueueItem } from '../_types';

export interface RejectModalProps {
  item: ReviewQueueItem;
  apiUrl: string;
  onClose: () => void;
  onRejected: () => void;
}

export function RejectModal({ item, apiUrl, onClose, onRejected }: RejectModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charCount = reason.length;
  const isValid = charCount >= 10 && charCount <= 500;

  async function handleReject() {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/review-queue/${item.type}/${item.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ rejectionReason: reason }),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? t('admin.reviewQueue.actionFailed'));
      }

      onRejected();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.reviewQueue.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- modal backdrop click-to-close, Cancel button provides keyboard exit
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
        <h2 className="font-display font-semibold text-lg sm:text-xl">
          {t('admin.reviewQueue.rejectModalTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{item.targetLabel}</p>

        <div className="mt-4">
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            {t('admin.reviewQueue.rejectReasonLabel')}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus of the reason field on modal open
            autoFocus
            placeholder={t('admin.reviewQueue.rejectReasonPlaceholder')}
            className="w-full resize-none rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <p
            className={[
              'mt-1 text-right text-xs',
              charCount > 500 ? 'text-danger' : 'text-muted',
            ].join(' ')}
          >
            {charCount} / 500
          </p>
        </div>

        {error && (
          <p className="mt-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-muted hover:text-foreground-secondary disabled:opacity-50"
          >
            {t('admin.adminRulesetsReview.cancel')}
          </button>
          <button
            onClick={() => void handleReject()}
            disabled={submitting || !isValid}
            className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger-hover disabled:opacity-50"
          >
            {submitting ? 'Rejecting…' : t('admin.reviewQueue.reject')}
          </button>
        </div>
      </div>
    </div>
  );
}
