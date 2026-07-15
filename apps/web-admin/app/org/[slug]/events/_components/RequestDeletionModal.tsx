'use client';

import { useRef, useState } from 'react';
import { Modal, useToast } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

interface Props {
  targetType: 'event' | 'tournament';
  targetId: string;
  targetLabel: string;
  onSuccess: () => void;
  onClose: () => void;
  /**
   * When true, archive the target event before submitting the request. The
   * API rejects a deletion request unless the event is already `archived`
   * (deletion-requests.service.ts), so the list-page flow — which acts on
   * still-published events — must archive first. Only meaningful for
   * `targetType: 'event'`; the detail-page banner opens this modal only once
   * the event is already archived and passes `archiveFirst={false}`.
   */
  archiveFirst?: boolean;
}

export function RequestDeletionModal({
  targetType,
  targetId,
  targetLabel,
  onSuccess,
  onClose,
  archiveFirst = false,
}: Props) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();
  // Pre-fill with a common example so the operator can submit in one click;
  // it stays fully editable and the 10–500 char rule still applies.
  const [reason, setReason] = useState<string>(() =>
    t('organizer.deletionRequest.reasonPresetCreatedByError'),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  const reasonLen = reason.trim().length;
  const isValid = reasonLen >= 10 && reasonLen <= 500;
  const willArchive = archiveFirst && targetType === 'event';

  const presets = [
    t('organizer.deletionRequest.reasonPresetCreatedByError'),
    t('organizer.deletionRequest.reasonPresetCreatedForTest'),
  ];

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      // Archive prerequisite: the API only accepts a deletion request for an
      // archived event. Do it first; bail (without creating a request) if it
      // fails so we don't leave the event in a half-changed state.
      if (willArchive) {
        const archiveRes = await fetch(`${apiUrl}/api/v1/events/${targetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: 'archived' }),
        });
        if (!archiveRes.ok) {
          setError(t('organizer.events.archiveError'));
          return;
        }
      }
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
    <Modal
      open
      onClose={onClose}
      busy={submitting}
      size="md"
      title={
        targetType === 'event'
          ? t('organizer.deletionRequest.requestDeletionModalTitleEvent')
          : t('organizer.deletionRequest.requestDeletionModalTitleTournament')
      }
      description={targetLabel}
      footer={
        <>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-sm text-foreground-secondary border border-border rounded-lg px-4 py-1.5 hover:bg-background disabled:opacity-50"
          >
            {t('organizer.deletionRequest.cancelRequest')}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !isValid}
            className="text-sm text-danger-foreground bg-danger hover:bg-danger-hover rounded-lg px-4 py-1.5 disabled:opacity-50"
          >
            {submitting ? t('common.saving') : t('organizer.deletionRequest.requestDeletionSubmit')}
          </button>
        </>
      }
    >
      {/* Irreversible-consequence callout — always shown. */}
      <div className="mb-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
        {t('organizer.deletionRequest.permanentDeleteWarning')}
      </div>

      {willArchive && (
        <div className="mb-3 text-xs text-warning bg-warning/10 border border-warning/30 rounded px-3 py-2">
          {t('organizer.deletionRequest.autoArchiveNotice')}
        </div>
      )}

      {error && (
        <div className="mb-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          {t('organizer.deletionRequest.requestDeletionModalReason')}
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="text-xs text-muted self-center">
            {t('organizer.deletionRequest.reasonPresetsLabel')}
          </span>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setReason(preset)}
              className="text-xs rounded-full border border-border px-2.5 py-1 text-foreground-secondary hover:bg-background"
            >
              {preset}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={5}
          maxLength={500}
          placeholder={t('organizer.deletionRequest.requestDeletionModalReasonPlaceholder')}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
        />
        <div className="flex justify-between mt-1">
          <span className={`text-xs ${reasonLen < 10 ? 'text-danger' : 'text-muted'}`}>
            {reasonLen < 10 ? `${10 - reasonLen} more characters required` : ''}
          </span>
          <span className={`text-xs ${reasonLen > 500 ? 'text-danger' : 'text-muted'}`}>
            {reasonLen} / 500
          </span>
        </div>
      </div>
    </Modal>
  );
}
