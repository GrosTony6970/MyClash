'use client';

/**
 * Hash-driven tabs for the public tournament page.
 * The active-tab underline + text colour pick up the tournament's
 * configured `color` token (falls back to red when none is set).
 * ARIA roles + keyboard nav (Arrow/Home/End) are preserved.
 *
 * Tab panels are wrapped with a CSS-driven cross-fade on switch; if
 * `prefers-reduced-motion` is set we hard-swap. We deliberately don't
 * use Next 15's experimental ViewTransition API yet — it adds a
 * client-component RSC boundary the rest of the page doesn't need.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { tintBorderClassFor, tintTextClassFor } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

export type TabKey =
  | 'participants'
  | 'pools'
  | 'poolmatches'
  | 'standings'
  | 'bracket'
  | 'podium'
  | 'finalranking';

interface TabDef {
  key: TabKey;
  label: string;
  panel: ReactNode;
  visible: boolean;
}

interface Props {
  defaultTab: TabKey;
  tabs: TabDef[];
  /**
   * Optional brand color token (e.g. 'red', 'blue', 'amber'). Drives
   * the active-tab border + text colour. Falls back to red-800 when
   * null — preserves the original look for tournaments without a
   * configured color.
   */
  colorToken?: string | null;
  /**
   * Optional route link rendered at the end of the tab strip, styled like
   * an inactive tab — for surfaces that live on their own route instead of
   * a hash panel (the Statistics page).
   */
  trailingLink?: { href: string; label: string } | null;
}

// Map a color token to the (border + text) Tailwind class pair used
// on the active tab. The two helpers return matching shades so the
// underline visually pairs with the text. Falls back to red-800 for
// tournaments with no configured color (legacy look preserved).
function activeTabClassesFor(token: string | null | undefined): string {
  if (!token) return 'border-accent text-accent';
  return `${tintTextClassFor(token)} ${tintBorderClassFor(token)}`;
}

const TAB_ORDER: TabKey[] = [
  'participants',
  'pools',
  'poolmatches',
  'standings',
  'bracket',
  'podium',
  'finalranking',
];

export function TournamentTabs({ defaultTab, tabs, colorToken, trailingLink }: Props) {
  const { t: tr } = useI18n();
  // Memoise so the derived arrays keep a stable identity across this client
  // component's internal re-renders (state / i18n context). `switchTo` depends
  // on `visibleKeys`, and the hash-sync effect depends on it too — an unstable
  // reference re-created the callback and re-subscribed the listener every
  // render (and tripped preserve-manual-memoization). A genuine new `tabs`
  // payload still recomputes correctly.
  const visibleTabs = useMemo(() => tabs.filter((t) => t.visible), [tabs]);
  const visibleKeys = useMemo(() => visibleTabs.map((t) => t.key), [visibleTabs]);
  const activeClasses = activeTabClassesFor(colorToken);

  const [active, setActive] = useState<TabKey>(defaultTab);
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    participants: null,
    pools: null,
    poolmatches: null,
    standings: null,
    bracket: null,
    podium: null,
    finalranking: null,
  });

  // Sync from URL hash on mount + listen for back/forward.
  useEffect(() => {
    function readHash() {
      const raw = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
      // The hash may carry a sub-segment (e.g. `poolmatches/<poolId>` from a
      // pool-card deep-link). Match on the base tab key before the first '/'.
      const base = (raw.split('/')[0] ?? '') as TabKey;
      if (TAB_ORDER.includes(base) && visibleKeys.includes(base)) {
        setActive(base);
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
        aria-label={tr('publicApp.tournament.tablistLabel')}
        className="flex flex-wrap items-center gap-1 border-b border-border"
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
                '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                isActive
                  ? activeClasses
                  : 'border-transparent text-foreground-secondary hover:text-foreground',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
        {trailingLink && (
          <Link
            href={trailingLink.href}
            className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-foreground-secondary transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {trailingLink.label} →
          </Link>
        )}
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
            {/* SR-only heading so screen-reader-by-heading workflows
                don't skip from the page H1 straight to the cards
                inside each panel. */}
            <h2 className="sr-only">{tab.label}</h2>
            {tab.panel}
          </section>
        );
      })}
    </div>
  );
}
