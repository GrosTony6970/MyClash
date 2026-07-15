'use client';

import { useState } from 'react';
import { t } from '@myclash/i18n';
import { Modal } from '@myclash/ui';
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
    <Modal
      open
      onClose={onClose}
      busy={submitting}
      title={t('admin.reviewQueue.rejectModalTitle')}
      description={item.targetLabel}
      size="md"
      footer={
        <>
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
        </>
      }
    >
      <label className="mb-1 block text-sm font-medium text-foreground-secondary">
        {t('admin.reviewQueue.rejectReasonLabel')}
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={4}
        placeholder={t('admin.reviewQueue.rejectReasonPlaceholder')}
        className="w-full resize-none rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      <p
        className={['mt-1 text-right text-xs', charCount > 500 ? 'text-danger' : 'text-muted'].join(
          ' ',
        )}
      >
        {charCount} / 500
      </p>
      {error && (
        <p className="mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
