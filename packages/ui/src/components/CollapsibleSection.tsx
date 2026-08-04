'use client';

import * as React from 'react';

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
 * chevron) over a body that only renders when open. Header content is styled by
 * the caller; the body takes an optional class so it can be spaced or targeted.
 *
 * Used by the public schedule's day / weapon groups and by the scoring app's
 * per-lice "all matches" list.
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
  header: React.ReactNode;
  children: React.ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
}): React.ReactNode {
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
