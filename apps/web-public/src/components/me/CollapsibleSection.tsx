'use client';

import type { ReactNode } from 'react';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={[
        'h-4 w-4 shrink-0 text-muted transition-transform',
        open ? '' : '-rotate-90',
      ].join(' ')}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * A retractable section: a full-width toggle button (header content + a trailing
 * chevron) over a body that only renders when open. Used for the schedule's day
 * groups and per-weapon groups. Header content is styled by the caller; the body
 * takes an optional id so it can be targeted / scrolled into view.
 */
export function CollapsibleSection({
  open,
  onToggle,
  header,
  children,
  headerClassName,
  bodyClassName,
}: {
  open: boolean;
  onToggle: () => void;
  header: ReactNode;
  children: ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
}): ReactNode {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={['flex w-full items-center gap-2 text-left', headerClassName ?? ''].join(' ')}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">{header}</span>
        <Chevron open={open} />
      </button>
      {open && <div className={bodyClassName}>{children}</div>}
    </div>
  );
}
