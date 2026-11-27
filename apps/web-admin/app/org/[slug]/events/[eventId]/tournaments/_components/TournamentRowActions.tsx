'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button, Modal, useConfirm } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { useOrganizerSelectedEvent } from '@/components/organizer-event-context';
import { RequestDeletionModal } from '../../../_components/RequestDeletionModal';
import { statusChangeQuestion } from '../_lib/status-change-question';

interface Props {
  tournament: { id: string; name: string; status: string };
  slug: string;
  eventId: string;
  isArchived: boolean;
  isReadOnly: boolean;
  /** The row's write is in flight — the page owns it so the row's status select waits too. */
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  /** `null` when a write starts, so the page clears its last banner. */
  onError: (message: string | null) => void;
  /**
   * After a successful write; the page reloads its rows from the server. A returned
   * promise is awaited before the row wakes up, so a second press cannot land on a
   * row the server has already archived or deleted.
   */
  onChanged: (notice: string) => void | Promise<void>;
  /** Shown between Edit and Archive (the Tournaments page's "Resume setup"). */
  extra?: ReactNode;
}

/**
 * Edit, Archive and Delete for one Tournament row — the only copy, used by the
 * Tournaments page and the Event overview. On an archived Event, Delete becomes
 * a deletion request.
 */
export function TournamentRowActions({
  tournament,
  slug,
  eventId,
  isArchived,
  isReadOnly,
  busy,
  onBusyChange,
  onError,
  onChanged,
  extra,
}: Props) {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const { refetchEvents } = useOrganizerSelectedEvent();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [requestDeletion, setRequestDeletion] = useState(false);

  async function archive() {
    const question = statusChangeQuestion('archived', tournament.name, t);
    if (question && !(await confirm(question))) return;
    onBusyChange(true);
    onError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournament.id}`, {
        method: 'PATCH',
        body: { status: 'archived' },
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('organizer.tournaments.archiveError'));
        if (message) onError(message);
        return;
      }
      await onChanged(t('organizer.tournaments.archived'));
    } finally {
      onBusyChange(false);
    }
  }

  async function hardDelete() {
    onBusyChange(true);
    onError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournament.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        // A hard delete is refused by what still points at the tournament.
        const message = failureMessage(r, t, t('organizer.tournaments.deleteError'));
        if (message) onError(message);
        return;
      }
      await onChanged(t('organizer.tournaments.deleted'));
      // The menu's Teams entry follows the Event's team Tournaments: the last one may be gone.
      void refetchEvents();
    } finally {
      onBusyChange(false);
      // Closed on failure too: the page's error banner sits behind the dialog, so
      // leaving it open would show a spinner stopping and nothing else.
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/org/${slug}/events/${eventId}/tournaments/${tournament.id}/settings#basics`}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
        >
          {t('organizer.tournaments.edit')}
        </Link>
        {extra}
        <Button
          type="button"
          size="sm"
          variant="cancel"
          disabled={busy || tournament.status === 'archived' || isReadOnly}
          onClick={() => void archive()}
        >
          {t('organizer.tournaments.archive')}
        </Button>
        {isArchived ? (
          <Button type="button" size="sm" variant="danger" onClick={() => setRequestDeletion(true)}>
            {t('organizer.deletionRequest.requestDeletion')}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            {t('organizer.tournaments.hardDelete')}
          </Button>
        )}
      </div>

      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(false)}
          busy={busy}
          size="md"
          title={t('organizer.tournaments.deleteTitle')}
          footer={
            <>
              <Button type="button" variant="cancel" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={busy}
                onClick={() => void hardDelete()}
              >
                {t('organizer.tournaments.confirmHardDelete')}
              </Button>
            </>
          }
        >
          <p className="mt-2 text-sm text-foreground-secondary">
            {t('organizer.tournaments.deleteWarning', { name: tournament.name })}
          </p>
        </Modal>
      )}

      {confirmDialog}

      {requestDeletion && (
        <RequestDeletionModal
          targetType="tournament"
          targetId={tournament.id}
          targetLabel={tournament.name}
          onSuccess={() => setRequestDeletion(false)}
          onClose={() => setRequestDeletion(false)}
        />
      )}
    </>
  );
}
