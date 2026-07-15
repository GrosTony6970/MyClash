'use client';

/**
 * BlockEditPopover — a centered modal to edit a schedule block's name, time
 * and (for pool/bracket blocks) lice span. The parent owns open state and
 * routes the saved draft to the right persistence path (a break uses the
 * programme move/resize/label endpoints; a match-block retimes / re-fans its
 * matches). Pool/round labels are derived, so `mode === 'block'` hides the
 * name field.
 *
 * Presentational — local draft state only, no I/O.
 */

import { useState } from 'react';
import { Modal } from '@myclash/ui';
import { ColorSwatchPicker } from '@/components/ColorSwatchPicker';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

export interface BlockEditDraft {
  label: string;
  startHHMM: string;
  endHHMM: string;
  liceIds: string[];
  /** "#rrggbb" or '' for the per-kind default. Only used in `break` mode. */
  colorHex: string;
}

interface Props {
  open: boolean;
  mode: 'block' | 'break';
  title: string;
  initial: BlockEditDraft;
  lices: { id: string; name: string }[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (draft: BlockEditDraft) => void;
}

const HHMM_PATTERN = '^([01]?[0-9]|2[0-3]):[0-5][0-9]$';

export function BlockEditPopover({
  open,
  mode,
  title,
  initial,
  lices,
  busy,
  error,
  onCancel,
  onSave,
}: Props) {
  const { t } = useI18n();
  const [label, setLabel] = useState(initial.label);
  const [startHHMM, setStartHHMM] = useState(initial.startHHMM);
  const [endHHMM, setEndHHMM] = useState(initial.endHHMM);
  const [liceIds, setLiceIds] = useState<string[]>(initial.liceIds);
  const [colorHex, setColorHex] = useState(initial.colorHex);

  function toggleLice(id: string) {
    setLiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      busy={busy}
      size="sm"
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-3 py-1 text-xs font-medium text-foreground-secondary hover:bg-background"
          >
            {t('organizer.schedulePage.editPopover.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave({ label, startHHMM, endHHMM, liceIds, colorHex })}
            className="rounded bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {t('organizer.schedulePage.editPopover.save')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {mode === 'break' ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-muted">
              {t('organizer.schedulePage.editPopover.nameLabel')}
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="rounded border border-border px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        ) : (
          <p className="text-sm font-semibold text-foreground-secondary">{label}</p>
        )}

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs">
            <span className="font-semibold text-muted">
              {t('organizer.schedulePage.editPopover.startLabel')}
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern={HHMM_PATTERN}
              placeholder="HH:MM"
              maxLength={5}
              value={startHHMM}
              onChange={(e) => setStartHHMM(e.target.value)}
              className="rounded border border-border px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          {mode === 'break' ? (
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="font-semibold text-muted">
                {t('organizer.schedulePage.editPopover.endLabel')}
              </span>
              <input
                type="text"
                inputMode="numeric"
                pattern={HHMM_PATTERN}
                placeholder="HH:MM"
                maxLength={5}
                value={endHHMM}
                onChange={(e) => setEndHHMM(e.target.value)}
                className="rounded border border-border px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          ) : null}
        </div>

        {mode === 'break' ? (
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-muted">
                {t('organizer.schedulePage.editPopover.colorLabel')}
              </span>
              {colorHex ? (
                <button
                  type="button"
                  onClick={() => setColorHex('')}
                  className="text-[11px] font-medium text-muted hover:text-foreground-secondary"
                >
                  {t('organizer.schedulePage.editPopover.colorDefault')}
                </button>
              ) : null}
            </div>
            <ColorSwatchPicker
              value={colorHex}
              onChange={setColorHex}
              ariaLabel={t('organizer.schedulePage.editPopover.colorAriaLabel')}
            />
          </div>
        ) : null}

        {mode === 'block' ? (
          <fieldset className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-muted">
              {t('organizer.schedulePage.editPopover.licesLabel')}
            </span>
            <div className="flex flex-wrap gap-2">
              {lices.map((l) => (
                <label
                  key={l.id}
                  className="flex items-center gap-1 text-sm text-foreground-secondary"
                >
                  <input
                    type="checkbox"
                    checked={liceIds.includes(l.id)}
                    onChange={() => toggleLice(l.id)}
                  />
                  {l.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
