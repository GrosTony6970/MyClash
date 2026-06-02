'use client';

/**
 * Hash-driven tabs for the public tournament page.
 * Mirrors the admin's `border-b-2 border-red-800 text-red-800` pattern
 * with proper ARIA roles + keyboard nav (Arrow/Home/End).
 *
 * Tab panels are wrapped with a CSS-driven cross-fade on switch; if
 * `prefers-reduced-motion` is set we hard-swap. We deliberately don't
 * use Next 15's experimental ViewTransition API yet — it adds a
 * client-component RSC boundary the rest of the page doesn't need.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type TabKey = 'pools' | 'standings' | 'bracket' | 'podium';

interface TabDef {
  key: TabKey;
  label: string;
  panel: ReactNode;
  visible: boolean;
}

interface Props {
  defaultTab: TabKey;
  tabs: TabDef[];
}

const TAB_ORDER: TabKey[] = ['pools', 'standings', 'bracket', 'podium'];

export function TournamentTabs({ defaultTab, tabs }: Props) {
  const visibleTabs = tabs.filter((t) => t.visible);
  const visibleKeys = visibleTabs.map((t) => t.key);

  const [active, setActive] = useState<TabKey>(defaultTab);
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    pools: null,
    standings: null,
    bracket: null,
    podium: null,
  });

  // Sync from URL hash on mount + listen for back/forward.
  useEffect(() => {
    function readHash() {
      const raw = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
      if (TAB_ORDER.includes(raw as TabKey) && visibleKeys.includes(raw as TabKey)) {
        setActive(raw as TabKey);
      }
    }
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [visibleKeys]);

  const switchTo = useCallback(
    (next: TabKey) => {
      if (!visibleKeys.includes(next)) return;
      setActive(next);
      // Update the hash without scrolling so deep-links + browser
      // back/forward keep working. history.replaceState avoids piling
      // history entries on every tab click.
      if (typeof window !== 'undefined') {
        history.replaceState(null, '', `#${next}`);
      }
    },
    [visibleKeys],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const idx = visibleKeys.indexOf(active);
    if (idx < 0) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % visibleKeys.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + visibleKeys.length) % visibleKeys.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visibleKeys.length - 1;
    if (next === null) return;
    e.preventDefault();
    const nextKey = visibleKeys[next]!;
    switchTo(nextKey);
    tabRefs.current[nextKey]?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Tournament sections"
        className="flex flex-wrap items-center gap-1 border-b border-stone-200"
      >
        {visibleTabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              role="tab"
              type="button"
              id={`tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => switchTo(tab.key)}
              onKeyDown={onKeyDown}
              className={[
                '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40',
                isActive
                  ? 'border-red-800 text-red-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {visibleTabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <section
            key={tab.key}
            role="tabpanel"
            id={`panel-${tab.key}`}
            aria-labelledby={`tab-${tab.key}`}
            hidden={!isActive}
            className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
          >
            {tab.panel}
          </section>
        );
      })}
    </div>
  );
}
