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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold">{t('admin.reviewQueue.rejectModalTitle')}</h2>
        <p className="mt-1 text-sm text-slate-500">{item.targetLabel}</p>

        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('admin.reviewQueue.rejectReasonLabel')}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            autoFocus
            placeholder={t('admin.reviewQueue.rejectReasonPlaceholder')}
            className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
          />
          <p
            className={[
              'mt-1 text-right text-xs',
              charCount > 500 ? 'text-red-600' : 'text-slate-400',
            ].join(' ')}
          >
            {charCount} / 500
          </p>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleReject()}
            disabled={submitting || !isValid}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {submitting ? 'Rejecting…' : t('admin.reviewQueue.reject')}
          </button>
        </div>
      </div>
    </div>
  );
}
