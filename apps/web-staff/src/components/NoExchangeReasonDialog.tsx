'use client';

/**
 * NoExchangeReasonDialog — asks WHY there was no exchange.
 *
 * The pad used to record every no-exchange as `other`, so a whole column of
 * the exchange log said nothing: the API has stored `no_exchange_reason` all
 * along and the timeline has always been able to label it, but nothing ever
 * gave the referee a way to say which one it was.
 *
 * Costs one extra tap mid-bout, so the options are pad-sized and a single tap
 * both records and dismisses — no separate confirm.
 *
 * Its own file rather than more lines in ScoringCenterControls, which is
 * already near the size the complexity gate wants split.
 */

import { Modal, NO_EXCHANGE_REASONS, NO_EXCHANGE_REASON_KEYS } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { NoExchangeReason } from '../hooks/useScoringSubmit';

interface NoExchangeReasonDialogProps {
  open: boolean;
  onClose: () => void;
  /** Records the exchange with this reason. The dialog closes itself after. */
  onChoose: (reason: NoExchangeReason) => void;
  /** Submit in flight — freezes the dialog rather than letting a double-tap double-record. */
  busy?: boolean;
}

export function NoExchangeReasonDialog({
  open,
  onClose,
  onChoose,
  busy = false,
}: NoExchangeReasonDialogProps) {
  const { t } = useI18n();

  function choose(reason: NoExchangeReason) {
    if (busy) return;
    onChoose(reason);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('scoring.pad.noExchangeReason')}
      size="sm"
      busy={busy}
    >
      <div className="flex flex-col gap-2">
        {NO_EXCHANGE_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            data-testid="no-exchange-reason"
            data-reason={reason}
            disabled={busy}
            onClick={() => choose(reason)}
            className="min-h-[64px] w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-base font-bold text-foreground-secondary hover:border-muted hover:bg-background active:bg-border disabled:opacity-40 touch-manipulation"
          >
            {t(NO_EXCHANGE_REASON_KEYS[reason])}
          </button>
        ))}
      </div>
    </Modal>
  );
}
