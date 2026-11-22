'use client';

import * as React from 'react';

export interface SegmentedTab<T extends string = string> {
  value: T;
  label: React.ReactNode;
}

export interface SegmentedTabsProps<T extends string = string> {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  value: T;
  onChange: (value: T) => void;
  'aria-label'?: string;
  /** Extra classes on the outer track. */
  className?: string;
}

/**
 * Tokenized in-page segmented tab control (event hub, profile Fighter/Referee).
 * Active segment uses the semantic accent; adopts the surrounding scope (e.g.
 * `data-accent="personal"` → blue) automatically. 44px+ touch targets.
 */
export function SegmentedTabs<T extends string = string>({
  tabs,
  value,
  onChange,
  className = '',
  ...rest
}: SegmentedTabsProps<T>): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      // A strip wider than a phone scrolls inside its track; it never widens the page.
      className={[
        'flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1',
        className,
      ].join(' ')}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={[
              'min-h-[40px] flex-1 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold transition-colors sm:px-3',
              '[touch-action:manipulation]',
              active
                ? 'bg-accent text-accent-foreground shadow-sm'
                : 'text-muted hover:bg-foreground/5 hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
