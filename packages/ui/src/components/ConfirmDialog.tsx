'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * ConfirmDialog — accessible, focus-trapped modal for destructive admin
 * actions. Replaces every `window.confirm(...)` call site.
 *
 * Behavior:
 *   • Escape cancels.
 *   • Backdrop click cancels.
 *   • Focus trapped to dialog while open; restored on close.
 *   • aria-modal + role="dialog" + aria-labelledby for screen-readers.
 *
 * Visual: scale-95 → 100 + fade on mount (120ms). Border-only design,
 * white card on slate-950/40 backdrop.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, confirm button uses the danger palette. Default false. */
  danger?: boolean;
  /** When true, disables the confirm button. */
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, busy, onCancel]);

  // Portal to <body> so the dialog escapes any sticky/transformed ancestor
  // (e.g. the schedule board's sticky sidebar) that would otherwise scope its
  // stacking context and let the page paint over it.
  if (!open || typeof document === 'undefined') return null;

  const confirmClasses = danger
    ? 'bg-red-800 hover:bg-red-900 text-white'
    : 'bg-slate-900 hover:bg-slate-700 text-white';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 dialog-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 dialog-card-enter"
      >
        <h2
          id="confirm-dialog-title"
          className="font-display text-xl font-medium tracking-tight text-slate-900"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
