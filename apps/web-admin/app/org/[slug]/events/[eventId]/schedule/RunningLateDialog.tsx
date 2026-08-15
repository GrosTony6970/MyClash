'use client';

import { useState } from 'react';
import { Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { DayDelayPreview, DayDelaySeed } from './day-delay';

/**
 * Confirm pushing the rest of a day back.
 *
 * A dialog rather than the one-click "+N" the piste column headers carry,
 * because this one is not scoped to a piste: it retimes every waiting fight on
 * the day and moves the programme bars with them, and none of that is on the
 * undo stack. The operator sees what it will touch before it happens, and can
 * correct the measured number — the board's drift is a heuristic off one bout,
 * and the person in the hall usually knows better.
 */
/**
 * MOUNTED ONLY WHILE OPEN, which is why there is no `open` prop and no effect
 * re-seeding the input. Keeping it mounted and resetting the field when `open`
 * flipped is a setState inside an effect — the cascading-render shape
 * `react-hooks/set-state-in-effect` rejects — and it would also offer a figure
 * measured against a delay that has since moved on.
 */
export interface RunningLateDialogProps {
  seed: DayDelaySeed;
  /** Event-zone `HH:MM` the shift starts from — everything earlier stays put. */
  fromTime: string;
  dayLabel: string;
  preview: DayDelayPreview;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (deltaMinutes: number) => void;
}

export function RunningLateDialog({
  seed,
  fromTime,
  dayLabel,
  preview,
  busy,
  onCancel,
  onConfirm,
}: RunningLateDialogProps) {
  const { t } = useI18n();
  const [minutes, setMinutes] = useState(String(seed.deltaMin));

  const parsed = Number.parseInt(minutes, 10);
  const valid = Number.isFinite(parsed) && parsed !== 0;

  return (
    <Modal
      open
      onClose={onCancel}
      busy={busy}
      size="sm"
      title={t('organizer.schedulePage.grid.runningLateHeading')}
      description={t('organizer.schedulePage.grid.runningLateBasis', {
        lice: seed.liceName,
        min: seed.deltaMin,
        basis: seed.basisLabel,
      })}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-40"
          >
            {t('organizer.schedulePage.grid.runningLateCancel')}
          </button>
          <button
            type="button"
            data-testid="running-late-confirm"
            onClick={() => onConfirm(parsed)}
            disabled={busy || !valid}
            className="rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            {busy
              ? t('organizer.schedulePage.grid.runningLateBusy')
              : t('organizer.schedulePage.grid.runningLateConfirm')}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-foreground-secondary">
        <label className="flex items-center gap-2">
          <span>{t('organizer.schedulePage.grid.runningLateAmount')}</span>
          <input
            type="number"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            disabled={busy}
            data-testid="running-late-minutes"
            className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm text-foreground"
          />
          <span>{t('organizer.schedulePage.grid.runningLateMinutes')}</span>
        </label>
        <p>{t('organizer.schedulePage.grid.runningLateFrom', { time: fromTime, day: dayLabel })}</p>
        <p>
          {t('organizer.schedulePage.grid.runningLateMoves', {
            bars: preview.bars,
            fights: preview.fights,
          })}
        </p>
        <p className="text-muted">{t('organizer.schedulePage.grid.runningLateKeeps')}</p>
      </div>
    </Modal>
  );
}
