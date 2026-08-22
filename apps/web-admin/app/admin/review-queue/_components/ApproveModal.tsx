'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { useState } from 'react';
import { Modal } from '@myclash/ui';
import type { ReviewQueueItem } from '../_types';

export interface ApproveModalProps {
  item: ReviewQueueItem;
  apiUrl: string;
  onClose: () => void;
  onApproved: () => void;
}

export function ApproveModal({ item, apiUrl, onClose, onApproved }: ApproveModalProps) {
  const { t } = useI18n();

  const [confirmInput, setConfirmInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDeletion = item.type === 'deletion';
  const canSubmit = !isDeletion || confirmInput === 'DELETE';

  async function handleApprove() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (isDeletion) body['typedConfirmation'] = 'DELETE';

      const r = await apiRequest(
        apiUrl,
        `/api/v1/admin/review-queue/${item.type}/${item.id}/approve`,
        { method: 'POST', body },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.reviewQueue.actionFailed'));
        if (message) setError(message);
        return;
      }
      onApproved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={submitting}
      size="md"
      title={t('admin.reviewQueue.approveModalTitle')}
      description={item.targetLabel}
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
            onClick={() => void handleApprove()}
            disabled={submitting || !canSubmit}
            className="rounded-md bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-success-hover disabled:opacity-50"
          >
            {submitting ? 'Approving…' : t('admin.reviewQueue.approve')}
          </button>
        </>
      }
    >
      {isDeletion && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
          <p className="text-sm font-semibold text-danger">
            {t('admin.reviewQueue.approveConfirmDeletion')}
          </p>
          <p className="mt-2 text-sm text-danger">{t('admin.reviewQueue.approveTypeDelete')}</p>
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            className="mt-2 w-full rounded-md border border-danger/30 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-danger"
            placeholder="DELETE"
          />
        </div>
      )}

      {!isDeletion && (
        <p className="text-sm text-foreground-secondary">
          {t('admin.adminRulesetsReview.approveConfirmPrompt')}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
