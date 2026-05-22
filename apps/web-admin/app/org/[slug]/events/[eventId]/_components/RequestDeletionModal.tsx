'use client';

import { useRef, useState } from 'react';
import { useToast } from '@myclash/ui';
import { t } from '@myclash/i18n';

interface Props {
  targetType: 'event' | 'tournament';
  targetId: string;
  targetLabel: string;
  onSuccess: () => void;
  onClose: () => void;
}

export function RequestDeletionModal({
  targetType,
  targetId,
  targetLabel,
  onSuccess,
  onClose,
}: Props) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  const reasonLen = reason.trim().length;
  const isValid = reasonLen >= 10 && reasonLen <= 500;

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/deletion-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetType, targetId, reason: reason.trim() }),
      });
      if (res.status === 409) {
        setError(t('organizer.deletionRequest.deletionRequestConflict'));
        return;
      }
      if (!res.ok) {
        setError(t('organizer.deletionRequest.deletionRequestConflict'));
        return;
      }
      toast.success(t('organizer.deletionRequest.deletionRequestSubmitted'));
      onSuccess();
    } catch {
      setError(t('organizer.deletionRequest.deletionRequestConflict'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold mb-1">
          {targetType === 'event'
            ? t('organizer.deletionRequest.requestDeletionModalTitleEvent')
            : t('organizer.deletionRequest.requestDeletionModalTitleTournament')}
        </h2>
        <p className="text-sm text-gray-500 mb-4">{targetLabel}</p>

        {error && (
          <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('organizer.deletionRequest.requestDeletionModalReason')}
          </label>
          <textarea
            ref={textareaRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
            maxLength={500}
            placeholder={t('organizer.deletionRequest.requestDeletionModalReasonPlaceholder')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
          />
          <div className="flex justify-between mt-1">
            <span className={`text-xs ${reasonLen < 10 ? 'text-red-500' : 'text-gray-400'}`}>
              {reasonLen < 10 ? `${10 - reasonLen} more characters required` : ''}
            </span>
            <span className={`text-xs ${reasonLen > 500 ? 'text-red-500' : 'text-gray-400'}`}>
              {reasonLen} / 500
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('organizer.deletionRequest.cancelRequest')}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !isValid}
            className="text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg px-4 py-1.5 disabled:opacity-50"
          >
            {submitting ? t('common.saving') : t('organizer.deletionRequest.requestDeletionSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
}
