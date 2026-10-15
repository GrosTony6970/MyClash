'use client';

import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogLayer } from '../hooks/useDialogLayer';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  DIALOG_BACKDROP,
  DIALOG_CANCEL,
  DIALOG_CARD,
  DIALOG_DESCRIPTION,
  DIALOG_TITLE,
  dialogConfirmClasses,
} from './dialog-classes';

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
 * Visual: scale-95 → 100 + fade on mount (120ms). Its classes are in
 * `dialog-classes.ts`, shared with `PromptDialog`.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The two buttons' words, already translated: there is no English default (X4). */
  confirmLabel: string;
  cancelLabel: string;
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
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Its own id: a question can open over another one.
  const titleId = useId();
  useFocusTrap(open, dialogRef);
  useDialogLayer(open, () => {
    if (!busy) onCancel();
  });

  // Portal to <body> so the dialog escapes any sticky/transformed ancestor
  // (e.g. the schedule board's sticky sidebar) that would otherwise scope its
  // stacking context and let the page paint over it.
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={DIALOG_BACKDROP}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={DIALOG_CARD}
      >
        <h2 id={titleId} className={DIALOG_TITLE}>
          {title}
        </h2>
        {description ? (
          // A div: a description may hold a list (O25 names an area's pistes in one).
          <div className={DIALOG_DESCRIPTION}>{description}</div>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={DIALOG_CANCEL}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={dialogConfirmClasses(danger)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
