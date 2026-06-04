'use client';

import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * Drawer — right-aligned slide-over panel for non-blocking config
 * UIs. Sister to ConfirmDialog but without baked-in confirm/cancel
 * buttons; the consumer renders whatever body they need.
 *
 * Used by the admin Schedule page to host the Programme Planner
 * behind a `⚙ Configure schedule` button (drawer pattern: setup
 * tools live behind a button; the workspace gets full real estate).
 *
 * Behavior:
 *   • Escape calls onClose.
 *   • Backdrop click calls onClose.
 *   • Focus trapped inside the drawer while open; restored on close.
 *   • aria-modal + role="dialog" + aria-labelledby for screen readers.
 *   • Body uses overflow-y-auto so long content scrolls internally.
 *
 * Visual: 200 ms slide-in from the right + backdrop fade. Respects
 * prefers-reduced-motion (handled by Tailwind's `motion-safe:`).
 */
export interface DrawerProps {
  /** Controlled open state. */
  open: boolean;
  /** Called when the user requests close (Esc, backdrop click, X button). */
  onClose: () => void;
  /** Drawer title shown in the header. */
  title: React.ReactNode;
  /** Drawer body. */
  children: React.ReactNode;
  /** Optional width override (default: '480px'). */
  width?: string;
}

export function Drawer({ open, onClose, title, children, width = '480px' }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        style={{ width }}
        className="flex h-full max-w-full flex-col border-l border-slate-200 bg-white shadow-xl motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2
            id="drawer-title"
            className="font-display text-lg font-semibold tracking-tight text-slate-900"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
