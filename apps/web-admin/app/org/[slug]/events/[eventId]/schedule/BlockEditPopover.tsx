'use client';

/* eslint-disable myclash/no-literal-string */

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
import { ColorSwatchPicker } from '@/components/ColorSwatchPicker';

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
  const [label, setLabel] = useState(initial.label);
  const [startHHMM, setStartHHMM] = useState(initial.startHHMM);
  const [endHHMM, setEndHHMM] = useState(initial.endHHMM);
  const [liceIds, setLiceIds] = useState<string[]>(initial.liceIds);
  const [colorHex, setColorHex] = useState(initial.colorHex);

  // The parent gives this popover a `key` per target, so each edit remounts
  // with fresh state — no re-seed effect needed.
  if (!open) return null;

  function toggleLice(id: string) {
    setLiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="presentation"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
        role="presentation"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-bold text-gray-800">{title}</h3>

        <div className="space-y-3">
          {mode === 'break' ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-gray-500">Name</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </label>
          ) : (
            <p className="text-sm font-semibold text-gray-700">{label}</p>
          )}

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="font-semibold text-gray-500">Start</span>
              <input
                type="text"
                inputMode="numeric"
                pattern={HHMM_PATTERN}
                placeholder="HH:MM"
                maxLength={5}
                value={startHHMM}
                onChange={(e) => setStartHHMM(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </label>
            {mode === 'break' ? (
              <label className="flex flex-1 flex-col gap-1 text-xs">
                <span className="font-semibold text-gray-500">End</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern={HHMM_PATTERN}
                  placeholder="HH:MM"
                  maxLength={5}
                  value={endHHMM}
                  onChange={(e) => setEndHHMM(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-red-600"
                />
              </label>
            ) : null}
          </div>

          {mode === 'break' ? (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-500">Color</span>
                {colorHex ? (
                  <button
                    type="button"
                    onClick={() => setColorHex('')}
                    className="text-[11px] font-medium text-gray-400 hover:text-gray-600"
                  >
                    Default
                  </button>
                ) : null}
              </div>
              <ColorSwatchPicker value={colorHex} onChange={setColorHex} ariaLabel="Block color" />
            </div>
          ) : null}

          {mode === 'block' ? (
            <fieldset className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-gray-500">Lices</span>
              <div className="flex flex-wrap gap-2">
                {lices.map((l) => (
                  <label key={l.id} className="flex items-center gap-1 text-sm text-gray-700">
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

          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave({ label, startHHMM, endHHMM, liceIds, colorHex })}
            className="rounded bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
