'use client';

import { useRef, useState } from 'react';
import { t } from '@myclash/i18n';
import type { ReviewQueueItem } from '../_types';

export interface ApproveModalProps {
  item: ReviewQueueItem;
  apiUrl: string;
  onClose: () => void;
  onApproved: () => void;
}

export function ApproveModal({ item, apiUrl, onClose, onApproved }: ApproveModalProps) {
  const [confirmInput, setConfirmInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDeletion = item.type === 'deletion';
  const canSubmit = !isDeletion || confirmInput === 'DELETE';

  async function handleApprove() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (isDeletion) body['typedConfirmation'] = 'DELETE';

      const res = await fetch(
        `${apiUrl}/api/v1/admin/review-queue/${item.type}/${item.id}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? t('admin.reviewQueue.actionFailed'));
      }

      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.reviewQueue.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
        <h2 className="font-display font-semibold text-lg sm:text-xl">
          {t('admin.reviewQueue.approveModalTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{item.targetLabel}</p>

        {isDeletion && (
          <div className="mt-4 rounded-md bg-danger/10 border border-danger/30 p-3">
            <p className="text-sm font-semibold text-danger">
              {t('admin.reviewQueue.approveConfirmDeletion')}
            </p>
            <p className="mt-2 text-sm text-danger">{t('admin.reviewQueue.approveTypeDelete')}</p>
            <input
              ref={inputRef}
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              autoFocus
              className="mt-2 w-full rounded-md border border-danger/30 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-danger"
              placeholder="DELETE"
            />
          </div>
        )}

        {!isDeletion && (
          <p className="mt-4 text-sm text-foreground-secondary">
            Are you sure you want to approve this request?
          </p>
        )}

        {error && (
          <p className="mt-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-muted hover:text-foreground-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleApprove()}
            disabled={submitting || !canSubmit}
            className="rounded-md bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-success-hover disabled:opacity-50"
          >
            {submitting ? 'Approving…' : t('admin.reviewQueue.approve')}
          </button>
        </div>
      </div>
    </div>
  );
}
