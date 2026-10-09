import type { ConfirmOptions } from '@myclash/ui';
import type { Translator } from '@myclash/next-i18n/client';

/**
 * The question an organiser answers before a Tournament takes `next`, or null
 * when the change is sent at once.
 *
 * Two statuses ask. "completed" tells the Tournament's fighters who have an
 * account that its results are out, and a notice that left cannot be taken back.
 * "archived" takes the Tournament off the public pages. Every door to those two
 * writes asks through here: the status menus of the Tournaments page and of the
 * Event dashboard, and the Archive button.
 */
export function statusChangeQuestion(
  next: string,
  name: string,
  t: Translator,
): ConfirmOptions | null {
  if (next === 'completed') {
    return {
      title: t('organizer.tournaments.statusConfirm.completedTitle', { name }),
      description: t('organizer.tournaments.statusConfirm.completedBody'),
      confirmLabel: t('organizer.tournaments.statusConfirm.completedYes'),
      cancelLabel: t('common.cancel'),
      danger: true,
    };
  }
  if (next === 'archived') {
    return {
      title: t('organizer.tournaments.statusConfirm.archivedTitle', { name }),
      description: t('organizer.tournaments.statusConfirm.archivedBody'),
      confirmLabel: t('organizer.tournaments.statusConfirm.archivedYes'),
      cancelLabel: t('common.cancel'),
      danger: true,
    };
  }
  return null;
}
