import { useState } from 'react';
import { apiRequest, failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';
import type { ConfirmOptions } from '@myclash/ui';
import { useI18n, type Translator } from '@myclash/next-i18n/client';

/**
 * The organiser messages one session's people from its roster (operator ruling 530). The message
 * goes through the Workshop's one message door, `POST workshops/:id/notify`, named to the session:
 * the server reaches that session's seats and waiting list, and refuses a cancelled session (532).
 */
export interface RosterMessageTarget {
  apiUrl: string;
  workshopId: string;
  sessionId: string;
  /** Seats and waiting-list places on the roster as it was read: the question's count. */
  count: number;
  /** The page's one confirm dialog. */
  confirm: (question: ConfirmOptions) => Promise<boolean>;
}

/**
 * The question before the message leaves: it reaches phones and mailboxes and cannot be taken
 * back. The count is the roster's when it was read; the server's count is the one said after.
 */
export function rosterMessageQuestion(title: string, count: number, t: Translator): ConfirmOptions {
  return {
    title: t('organizer.workshopsPage.message.confirmTitle', { title }),
    description: t('organizer.workshopsPage.message.confirmBody', { count }),
    confirmLabel: t('organizer.workshopsPage.message.send'),
    cancelLabel: t('common.cancel'),
  };
}

/**
 * A refused message, in the reader's language. A session cancelled after its roster was opened
 * has its own sentence: the server's would be English. Any other failure goes to `failureMessage`.
 */
export function rosterMessageRefusal(failure: ApiFailure, t: Translator): string | null {
  if (failureCode(failure) === 'WORKSHOP_SESSION_CANCELLED') {
    return t('organizer.workshopsPage.message.sessionCancelled');
  }
  return failureMessage(failure, t, t('organizer.workshopsPage.message.failed'));
}

export type RosterMessageOutcome = { sent: number } | { error: string } | null;

/** The box's state and its Send. */
export function useRosterMessage(target: RosterMessageTarget) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RosterMessageOutcome>(null);
  const ready = Boolean(title.trim() && body.trim()) && !busy;

  async function send() {
    if (!ready) return;
    const message = { title: title.trim(), body: body.trim() };
    if (!(await target.confirm(rosterMessageQuestion(message.title, target.count, t)))) return;
    setBusy(true);
    setOutcome(null);
    try {
      const r = await apiRequest<{ recipientCount: number }>(
        target.apiUrl,
        `/api/v1/workshops/${target.workshopId}/notify`,
        { method: 'POST', body: { ...message, sessionId: target.sessionId } },
      );
      if (!r.ok) {
        const words = rosterMessageRefusal(r, t);
        if (words) setOutcome({ error: words });
        return;
      }
      setOutcome({ sent: r.data.recipientCount });
      setTitle('');
      setBody('');
    } finally {
      setBusy(false);
    }
  }

  return { title, setTitle, body, setBody, busy, ready, outcome, send };
}
