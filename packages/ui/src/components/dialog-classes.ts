/**
 * The look of the two shared question dialogs, `ConfirmDialog` and `PromptDialog`: one owner,
 * so the two cannot drift apart.
 *
 * Tokens only. Both dialogs portal to `<body>`, so they take the scope `<body>` carries: light
 * on the organiser and public sites, the tablet's own scope on the pad (dark by default). Ruled
 * 2026-10-15: on the tablet the dialog follows the tablet rather than staying white. The
 * buttons are 44px tall, the touch size (`docs/design/web-staff.md`).
 */

export const DIALOG_BACKDROP =
  'fixed inset-0 z-overlay flex items-center justify-center bg-black/40 p-4 dialog-enter';

export const DIALOG_CARD =
  'w-full max-w-md rounded-lg border border-border bg-surface p-6 dialog-card-enter';

export const DIALOG_TITLE = 'font-display text-xl font-medium tracking-tight text-foreground';

export const DIALOG_DESCRIPTION = 'mt-2 text-sm leading-relaxed text-foreground-secondary';

/** The text field of `PromptDialog`. */
export const DIALOG_FIELD =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

const DIALOG_BUTTON =
  'min-h-[44px] rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export const DIALOG_CANCEL = `${DIALOG_BUTTON} border border-border bg-surface text-foreground-secondary hover:bg-background`;

/** The confirm button: the danger fill for a destructive question, the strong fill otherwise. */
export function dialogConfirmClasses(danger: boolean): string {
  return `${DIALOG_BUTTON} shadow-sm ${
    danger
      ? 'bg-danger text-danger-foreground hover:bg-danger-hover'
      : 'bg-strong text-strong-foreground hover:bg-strong-hover'
  }`;
}
