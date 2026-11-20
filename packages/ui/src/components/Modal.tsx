'use client';

import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogLayer } from '../hooks/useDialogLayer';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * Modal — the shared accessible dialog shell for admin/public overlays.
 *
 * Provides the a11y chrome every hand-rolled `fixed inset-0` overlay was
 * missing: portal to <body> (escapes sticky/transformed ancestors), focus
 * trap, Escape-to-close, backdrop-click-to-close, and
 * role="dialog"/aria-modal/aria-labelledby. Layout is header / scrollable
 * body / sticky footer so long content scrolls while the actions stay put.
 *
 * Fully tokenized (surface/border/muted/foreground); the backdrop is a plain
 * black scrim (dark in every theme, as a scrim should be). Content-only
 * dialogs pass `hideHeader` and label themselves.
 *
 * For simple confirm/prompt flows prefer ConfirmDialog / usePrompt — this is
 * for dialogs with custom body content or forms.
 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
};

interface ModalBaseProps {
  open: boolean;
  onClose: () => void;
  /** Heading text — also the accessible name (aria-labelledby). */
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Sticky footer content (usually the action buttons). */
  footer?: React.ReactNode;
  /** While true, Escape and backdrop-click do NOT close (an op is running). */
  busy?: boolean;
  /**
   * Accessible name when there is no visible title text (rare). Provide this
   * OR a string `title`; a non-string title should be paired with `ariaLabel`.
   */
  ariaLabel?: string;
  /** Keys pressed inside the dialog (a side panel's arrow keys). */
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  /**
   * Where focus goes on close, when not to the element focused at opening: a panel that moved
   * to another row gives focus back to that row. See `useFocusTrap`.
   */
  returnFocus?: () => HTMLElement | null;
}

/**
 * `center` is the dialog card. `side` is a panel full height on the right, over the dimmed page
 * (ruling 912): it has one width, so it takes no `size`.
 */
export type ModalProps = ModalBaseProps &
  ({ placement?: 'center'; size?: ModalSize } | { placement: 'side'; size?: never });

/** The side panel is paper on paper: a left hairline, no shadow (DESIGN.md, Elevation). */
const SIDE_BACKDROP = 'dialog-enter fixed inset-0 z-overlay flex justify-end bg-black/50';
const SIDE_CARD =
  'sheet-enter flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-surface';

function cardClass(props: ModalProps): string {
  if (props.placement === 'side') return SIDE_CARD;
  return `dialog-card-enter flex max-h-[90vh] w-full ${SIZE_CLASS[props.size ?? 'md']} flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl`;
}

export function Modal(props: ModalProps) {
  const {
    open,
    onClose,
    title,
    description,
    children,
    footer,
    busy = false,
    ariaLabel,
    onKeyDown,
    returnFocus,
  } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, dialogRef, returnFocus);
  // Escape reaches this window only when no question is open over it.
  useDialogLayer(open, () => {
    if (!busy) onClose();
  });

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop click-to-close; Escape + the Cancel/Close button provide keyboard exit
    <div
      className={
        props.placement === 'side'
          ? SIDE_BACKDROP
          : 'dialog-enter fixed inset-0 z-overlay flex items-center justify-center bg-black/50 p-4'
      }
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the dialog takes a side panel's arrow keys; its buttons stay the way to act */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cardClass(props)}
      >
        <div className="shrink-0 border-b border-border px-6 py-4">
          <h2
            id={titleId}
            className="font-display text-lg font-semibold text-foreground sm:text-xl"
          >
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {/* `data-modal-body`: a key pressed on the scrolling body itself scrolls it (a side
            panel's arrow keys leave it alone). */}
        <div data-modal-body className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
