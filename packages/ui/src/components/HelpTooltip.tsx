'use client';

import * as React from 'react';

/**
 * Either a plain sentence (the common case, which labels itself) or richer
 * content — which cannot label itself, so `ariaLabel` becomes required rather
 * than optional. Encoding that as a union means a structured tooltip cannot be
 * shipped without an accessible name.
 */
export type HelpTooltipProps =
  | {
      /** Help text shown in the tooltip popover. */
      text: string;
      /** Optional accessible label override for the trigger button. */
      ariaLabel?: string;
      children?: never;
    }
  | {
      text?: never;
      /** Structured popover content (e.g. StatusHelp's three fields). */
      children: React.ReactNode;
      /** Required: structured content has no sentence to name the trigger by. */
      ariaLabel: string;
    };

/**
 * Small inline help-text affordance — a circled ⓘ icon that reveals a
 * 280px tooltip on hover or focus. CSS-only show/hide via the parent
 * `group` class. Keyboard-accessible: trigger is a real `<button>` exposed
 * with an aria-label, and the tooltip is referenced by aria-describedby
 * for screen-reader users.
 */
export const HelpTooltip: React.FC<HelpTooltipProps> = ({ text, ariaLabel, children }) => {
  const id = React.useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel ?? `Help: ${text}`}
        aria-describedby={id}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-red-800/30"
      >
        ⓘ
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-[280px] -translate-x-1/2 rounded-md bg-slate-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white shadow-lg group-hover:block group-focus-within:block"
      >
        {children ?? text}
      </span>
    </span>
  );
};
