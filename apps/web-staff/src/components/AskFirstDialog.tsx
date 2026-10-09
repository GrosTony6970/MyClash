'use client';

import { Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

interface AskFirstDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
}

/**
 * A press that one tap must not carry out asks first: a red or black card of
 * the penalty list, a hit rewritten as "no exchange".
 *
 * It is the shared `Modal`, so the Space bar leaves the clock alone while it is
 * up (`MatchView`). Cancel comes FIRST, as on the pause dialogs
 * (`MatchPauseDialogs`): the focus lands on it, and a Space after a slip closes
 * the question and carries out nothing.
 */
export function AskFirstDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
}: AskFirstDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border-2 border-border bg-surface px-4 py-2 text-sm font-bold text-foreground-secondary hover:bg-border"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="ask-first-confirm"
            onClick={onConfirm}
            className="min-h-[44px] rounded-lg border-2 border-danger bg-danger/20 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/30"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-foreground-secondary">{message}</p>
    </Modal>
  );
}
