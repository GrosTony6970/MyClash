'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogLayer } from '../hooks/useDialogLayer';
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
  /**
   * When true, the single-line input masks what is typed (PINs, secrets).
   * Ignored by the `multiline` branch — a masked textarea is not a thing.
   */
  masked?: boolean;
  /** When true, disables the confirm button. */
  busy?: boolean;
  /** Initial value. */
  initialValue?: string;
  /** The field's visible name (O27). Words already translated: this package never translates. */
  fieldLabel?: string;
  /**
   * Why the typed value cannot be confirmed, already translated, or null when it can (O27).
   * Checked as the value is typed: the reason shows under the field and Confirm stays off.
   */
  validate?: (value: string) => string | null;
  /** A show / hide button on a masked field, with its two words (O27). */
  revealable?: { show: string; hide: string };
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
  masked = false,
  busy = false,
  initialValue = '',
  fieldLabel,
  validate,
  revealable,
}: PromptDialogProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(initialValue);
  const titleId = useId();

  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  useDialogLayer(open, () => {
    if (!busy) onCancel();
  });

  // Portal to <body> so the dialog escapes any sticky/transformed ancestor's
  // stacking context (see ConfirmDialog).
  if (!open || typeof document === 'undefined') return null;

  // The reason waits for the first key: an empty field is closed by the rule above anyway.
  const reason = validate && value !== '' ? validate(value) : null;
  const canConfirm = (allowEmpty || value.trim().length > 0) && reason === null;
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
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 dialog-card-enter"
      >
        <h2 id={titleId} className="font-display text-xl font-medium tracking-tight text-slate-900">
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
              aria-label={fieldLabel}
              rows={3}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-800 focus:outline-none focus:ring-2 focus:ring-red-800/20"
            />
          ) : (
            <PromptInput
              value={value}
              onChange={setValue}
              placeholder={placeholder}
              masked={masked}
              fieldLabel={fieldLabel}
              reason={reason}
              revealable={revealable}
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

/**
 * The one-line field: its name above it, the reason it cannot be confirmed under it, and a
 * show / hide button on a masked field that offers one (O27).
 */
interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  masked: boolean;
  fieldLabel?: string;
  reason: string | null;
  revealable?: { show: string; hide: string };
}

function PromptInput({
  value,
  onChange,
  placeholder,
  masked,
  fieldLabel,
  reason,
  revealable,
}: PromptInputProps) {
  const fieldId = useId();
  const [shown, setShown] = useState(false);
  const hidden = masked && !shown;
  return (
    <>
      {fieldLabel && (
        <label
          htmlFor={fieldId}
          className="mb-1 block text-sm font-medium text-foreground-secondary"
        >
          {fieldLabel}
        </label>
      )}
      <div className="flex gap-2">
        <input
          id={fieldId}
          autoFocus
          type={hidden ? 'password' : 'text'}
          autoComplete={masked ? 'off' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={reason !== null}
          aria-describedby={reason !== null ? `${fieldId}-reason` : undefined}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-800 focus:outline-none focus:ring-2 focus:ring-red-800/20"
        />
        {masked && revealable && (
          <RevealButton shown={shown} onToggle={() => setShown((now) => !now)} words={revealable} />
        )}
      </div>
      {reason !== null && (
        <p id={`${fieldId}-reason`} className="mt-1 text-sm text-danger">
          {reason}
        </p>
      )}
    </>
  );
}

function RevealButton({
  shown,
  onToggle,
  words,
}: {
  shown: boolean;
  onToggle: () => void;
  words: { show: string; hide: string };
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      className="shrink-0 rounded-md border border-border px-3 text-sm font-semibold text-foreground-secondary hover:bg-background"
    >
      {shown ? words.hide : words.show}
    </button>
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
  /** Mask the typed value (PINs). See {@link PromptDialogProps.masked}. */
  masked?: boolean;
  initialValue?: string;
  /** See {@link PromptDialogProps.fieldLabel}. */
  fieldLabel?: string;
  /** See {@link PromptDialogProps.validate}. */
  validate?: (value: string) => string | null;
  /** See {@link PromptDialogProps.revealable}. */
  revealable?: { show: string; hide: string };
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

  // Every option reaches the dialog: a list of them here dropped the ones added later.
  const { open, ...options } = state;
  const promptDialog = (
    <PromptDialog
      {...options}
      open={open}
      onConfirm={(value) => settle(value)}
      onCancel={() => settle(null)}
    />
  );

  return { prompt, promptDialog };
}
