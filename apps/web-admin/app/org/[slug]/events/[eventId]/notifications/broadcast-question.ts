import type { ConfirmOptions } from '@myclash/ui';
import type { Translator } from '@myclash/next-i18n/client';

/** What the organiser is about to send, in the words of the page. */
export interface BroadcastToAsk {
  title: string;
  /** The words of the audience button that is pressed. */
  audience: string;
  /** The words of the type button that is pressed. */
  severity: string;
  /** The number of people picked by hand, or null for an audience the server works out. */
  selectedCount: number | null;
  /** The server keeps this audience to one Tournament: the page was opened from it. */
  oneTournament: boolean;
}

/**
 * The question an organiser answers before a broadcast leaves. A broadcast
 * reaches every phone of its audience and cannot be taken back, so the question
 * says which message goes, to whom, and as what. People picked by hand are
 * counted instead of named.
 */
export function broadcastQuestion(message: BroadcastToAsk, t: Translator): ConfirmOptions {
  const audience =
    message.selectedCount === null
      ? message.audience
      : t('organizer.broadcast.confirmSelected', { count: message.selectedCount });
  const values = { audience, severity: message.severity };
  return {
    title: t('organizer.broadcast.confirmTitle', { title: message.title }),
    description: message.oneTournament
      ? t('organizer.broadcast.confirmBodyOneTournament', values)
      : t('organizer.broadcast.confirmBody', values),
    confirmLabel: t('organizer.broadcast.send'),
    cancelLabel: t('common.cancel'),
  };
}

/**
 * The audiences the server narrows to the Tournament in the address
 * (`getFighterRecipients` / `getRefereeRecipients`). "Everyone" and people
 * picked by hand ignore it.
 */
export function narrowedToTournament(targetType: string, tournamentId: string | null): boolean {
  return (
    Boolean(tournamentId) &&
    (targetType === 'fighters' ||
      targetType === 'referees' ||
      targetType === 'fighters_and_referees')
  );
}
