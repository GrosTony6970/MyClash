'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * PromptDialog — accessible focus-trapped modal that asks for a single text
 * value (e.g. rejection reason, deletion confirmation phrase). Replaces every
 * `window.prompt(...)` call site.
 *
 * Behavior:
 *   • Escape cancels.
 *   • Submit fires onConfirm(value).
 *   • Empty value disables the confirm button unless `allowEmpty` is true.
 */
export interface PromptDialogProps {
  open: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, a danger-style confirm button. */
  danger?: boolean;
  /** When true, allow submitting an empty string. Default false. */
  allowEmpty?: boolean;
  /** When true, render a textarea instead of an input. Default false. */
  multiline?: boolean;
  /** When true, disables the confirm button. */
  busy?: boolean;
  /** Initial value. */
  initialValue?: string;
}

export function PromptDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  placeholder,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  allowEmpty = false,
  multiline = false,
  busy = false,
  initialValue = '',
}: PromptDialogProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(initialValue);

  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, busy, onCancel]);

  // Portal to <body> so the dialog escapes any sticky/transformed ancestor's
  // stacking context (see ConfirmDialog).
  if (!open || typeof document === 'undefined') return null;

  const canConfirm = allowEmpty || value.trim().length > 0;
  const confirmClasses = danger
    ? 'bg-red-800 hover:bg-red-900 text-white'
    : 'bg-slate-900 hover:bg-slate-700 text-white';

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canConfirm || busy) return;
    onConfirm(value);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-overlay flex items-center justify-center bg-slate-950/40 p-4 dialog-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 dialog-card-enter"
      >
        <h2
          id="prompt-dialog-title"
          className="font-display text-xl font-medium tracking-tight text-slate-900"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
        ) : null}
        <div className="mt-4">
          {multiline ? (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              rows={3}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-800 focus:outline-none focus:ring-2 focus:ring-red-800/20"
            />
          ) : (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-800 focus:outline-none focus:ring-2 focus:ring-red-800/20"
            />
          )}
        </div>
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
            type="submit"
            disabled={busy || !canConfirm}
            className={`rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export interface PromptOptions {
  title: ReactNode;
  description?: ReactNode;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  allowEmpty?: boolean;
  multiline?: boolean;
  initialValue?: string;
}

/**
 * Promise-based prompt backed by {@link PromptDialog} — the in-app
 * replacement for `window.prompt`. Resolves to the entered string, or `null`
 * when cancelled. Usage:
 *
 *   const { prompt, promptDialog } = usePrompt();
 *   const reason = await prompt({ title: 'Reason for rejection' });
 *   if (reason === null) return;
 *   // …render {promptDialog} once in the component tree.
 */
export function usePrompt(): {
  prompt: (opts: PromptOptions) => Promise<string | null>;
  promptDialog: ReactNode;
} {
  const [state, setState] = useState<PromptOptions & { open: boolean }>({
    open: false,
    title: '',
  });
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setState({ ...opts, open: true });
      }),
    [],
  );

  const settle = useCallback((value: string | null) => {
    setState((s) => ({ ...s, open: false }));
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const promptDialog = (
    <PromptDialog
      open={state.open}
      title={state.title}
      description={state.description}
      placeholder={state.placeholder}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      allowEmpty={state.allowEmpty}
      multiline={state.multiline}
      initialValue={state.initialValue}
      onConfirm={(value) => settle(value)}
      onCancel={() => settle(null)}
    />
  );

  return { prompt, promptDialog };
}
