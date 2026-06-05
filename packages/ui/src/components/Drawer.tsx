'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
 *   • Optional `resizable` adds a leading-edge drag handle; pair
 *     with `persistKey` to remember the operator's preferred width
 *     across reloads.
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
  /** Default width (default: '480px'). Persisted width overrides this. */
  width?: string;
  /** When true, render a leading-edge drag handle that lets the
   *  operator resize the panel. Clamped to [320, window.innerWidth - 80]. */
  resizable?: boolean;
  /** When set, the drawer reads its initial width from
   *  `localStorage['drawer-width:'+persistKey]` and writes the new
   *  width on `pointerup`. Only consulted when `resizable` is true. */
  persistKey?: string;
}

const MIN_WIDTH_PX = 320;
const STORAGE_PREFIX = 'drawer-width:';

function parsePx(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const trimmed = value.trim();
  const px = trimmed.endsWith('px') ? Number.parseInt(trimmed.slice(0, -2), 10) : Number.NaN;
  return Number.isFinite(px) ? px : fallback;
}

function readPersistedWidth(persistKey: string | undefined): number | null {
  if (!persistKey || typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + persistKey);
  const parsed = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= MIN_WIDTH_PX ? parsed : null;
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = '480px',
  resizable = false,
  persistKey,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  // null = use the prop `width`; number = explicit pixel override.
  const [widthPx, setWidthPx] = useState<number | null>(() =>
    resizable ? readPersistedWidth(persistKey) : null,
  );

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const onHandlePointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      if (!resizable) return;
      ev.preventDefault();
      const startX = ev.clientX;
      const startWidth = panelRef.current?.getBoundingClientRect().width ?? parsePx(width, 480);
      const maxWidth = window.innerWidth - 80;
      const handle = ev.currentTarget;
      handle.setPointerCapture(ev.pointerId);

      function onMove(e: PointerEvent) {
        // Right-mounted drawer: dragging the LEFT-edge handle to the
        // left grows the panel (delta = startX - e.clientX).
        const next = Math.max(MIN_WIDTH_PX, Math.min(maxWidth, startWidth + (startX - e.clientX)));
        setWidthPx(next);
      }
      function onUp(e: PointerEvent) {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        if (persistKey) {
          const finalWidth = panelRef.current?.getBoundingClientRect().width ?? startWidth;
          window.localStorage.setItem(STORAGE_PREFIX + persistKey, String(Math.round(finalWidth)));
        }
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    },
    [resizable, persistKey, width],
  );

  if (!open) return null;

  const appliedWidth = widthPx != null ? `${widthPx}px` : width;

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
        style={{ width: appliedWidth }}
        className="relative flex h-full max-w-full flex-col border-l border-slate-200 bg-white shadow-xl motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200"
      >
        {resizable && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize drawer"
            onPointerDown={onHandlePointerDown}
            data-testid="drawer-resize-handle"
            className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent hover:bg-red-500/40"
          />
        )}
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
