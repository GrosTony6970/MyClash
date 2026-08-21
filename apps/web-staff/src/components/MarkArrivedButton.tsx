'use client';

import { useI18n } from '@myclash/next-i18n/client';

/**
 * "This person is here" — the desk's one write, wherever it is offered.
 *
 * Two screens offer it: the search results on `/desk` and the Missing-at-risk
 * list. They had a byte-identical copy each, which is how the fix below would
 * have landed on one and not the other.
 *
 * ── Outline, not a filled chip ──────────────────────────────────────────────
 * It used to be `bg-accent` — filled, in the red this app uses for the active
 * state — carrying the past-tense label "Arrived". A volunteer reading a queue
 * of those saw a roster that had already been checked in. Nothing here is a
 * selected state: an arrived row swaps this control for the arrival time and
 * an Undo.
 */
export function MarkArrivedButton({
  personId,
  onMark,
}: {
  personId: string;
  onMark: (personId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={() => onMark(personId)}
      className="min-h-[44px] rounded-lg border border-success px-5 text-sm font-bold text-success [touch-action:manipulation]"
    >
      {t('scoring.desk.markArrived')}
    </button>
  );
}
