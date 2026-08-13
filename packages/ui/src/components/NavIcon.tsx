import * as React from 'react';

import { LUCIDE_GLYPHS, type GlyphName, type IconNode } from './nav-icon-glyphs';

/**
 * NavIcon — the single glyph vocabulary for every MyClash sidebar.
 *
 * Names are SEMANTIC (`reviewQueue`), never the glyph's own name
 * (`clipboardCheck`), so swapping the artwork later is a one-line change here
 * and touches no call site. `Record<NavIconName, GlyphName>` makes a missing
 * entry a compile error rather than a blank square at runtime.
 *
 * The glyph strokes `currentColor` and carries no colour of its own: a nav row
 * is muted at rest, `text-foreground` on hover, `text-accent-foreground` on the
 * active row, and the icon follows. This replaced a bordered tile holding a
 * gold two-letter abbreviation (`RQ`, `DQ`, `FR`…) that nobody decoded without
 * reading the label next to it.
 *
 * Always `aria-hidden`: every nav row has a visible text label, so announcing
 * the icon would only duplicate it.
 *
 * A slug may be reused across sidebars for the same concept (`leagues` covers
 * Leagues, My leagues and /me Leagues; `switchWorkspace` marks both the
 * web-admin `WorkspaceSwitcher` and web-public's link into it) — but never
 * twice inside one sidebar.
 *
 * ── Why the path data is vendored ───────────────────────────────────────────
 * This file used to import 51 named icons from `lucide-react`. Because this
 * package compiles to CommonJS (`module: Node16`, tsconfig.lib.json), the
 * bundler saw a `require('lucide-react')` it could not analyse and pulled the
 * whole barrel — 2,011 icons, measured at 188 KB gzip — into a chunk named by
 * every app's ROOT LAYOUT `entryJSFiles`, i.e. downloaded on every page load of
 * all three apps. The old comment here claimed first-load JS was unaffected
 * because the barrel missed `rootMainFiles`; that was true of the budget's
 * definition and false of the browser's.
 *
 * So `nav-icon-glyphs.ts` carries the 51 `__iconNode` arrays (17 KB raw, 4 KB
 * gzip) and `Glyph` below reproduces lucide's `<svg>` exactly — same default
 * attributes, same `lucide lucide-<name>` classes, same attribute order. The
 * file is GENERATED: `node packages/ui/scripts/generate-nav-icons.mjs`, and
 * `nav-icon-glyphs.test.ts` regenerates it from `node_modules` on every run, so
 * a lucide upgrade that redraws an icon goes red instead of drifting silently.
 *
 * All 52 slugs were diffed against the markup lucide produced, and every one is
 * byte-identical but for a single class: for the two digit-bearing names lucide
 * also emits a legacy duplicate (`lucide-building2` beside `lucide-building-2`,
 * `lucide-clock3` beside `lucide-clock-3`). Only the canonical one is kept —
 * nothing in the repo's CSS selects a `.lucide*` class.
 *
 * Adding an icon is therefore no longer free: add the slug below, point it at a
 * lucide glyph name, and re-run the generator.
 *
 * `'use client'` is gone with the barrel. Lucide 1.x icons read a context
 * (`useLucideContext`) on every render, which made this a hook-calling
 * component; `Glyph` reads nothing, so the module is usable from a server
 * component too. Every current caller is a client sidebar, which still works —
 * a module without the directive is pulled into whichever graph imports it.
 */
export const NAV_ICON_NAMES = [
  // Platform console (super-admin)
  'overview',
  'organizations',
  'accounts',
  'globalProfiles',
  'clubs',
  'leagues',
  'rulesets',
  'weapons',
  'reviewQueue',
  'frozenResults',
  'pendingClaims',
  'ratings',
  'system',
  'backups',
  'auditLog',
  'ai',
  'aiKeys',
  'aiModels',
  'aiBudget',
  'dataQuality',
  'dataRetention',
  'featureFlags',
  // Organiser workspace
  'events',
  'members',
  'venues',
  // Event hub
  'eventOverview',
  'persons',
  'referees',
  'staff',
  'startOfDay',
  'clockReport',
  'live',
  'tournaments',
  'pools',
  'swiss',
  'bracket',
  'finalRanking',
  'penalties',
  'schedule',
  'statistics',
  'workshops',
  'compensation',
  'notifications',
  'theme',
  'archive',
  'aiAssistant',
  'chat',
  // Personal space
  'profile',
  'settings',
  'security',
  // Cross-shell
  'switchWorkspace',
  'logout',
] as const;

export type NavIconName = (typeof NAV_ICON_NAMES)[number];

export const NAV_ICON_GLYPHS: Record<NavIconName, GlyphName> = {
  overview: 'house',
  organizations: 'building-2',
  accounts: 'user-cog',
  globalProfiles: 'globe',
  clubs: 'shield',
  leagues: 'medal',
  rulesets: 'scale',
  weapons: 'swords',
  reviewQueue: 'clipboard-check',
  frozenResults: 'snowflake',
  pendingClaims: 'user-check',
  ratings: 'trending-up',
  system: 'server',
  backups: 'database-backup',
  auditLog: 'scroll-text',
  ai: 'sparkles',
  aiKeys: 'key-round',
  aiModels: 'cpu',
  aiBudget: 'wallet',
  dataQuality: 'scan-search',
  dataRetention: 'shield-check',
  featureFlags: 'flag',
  events: 'calendar-days',
  members: 'users',
  venues: 'map-pin',
  eventOverview: 'layout-dashboard',
  persons: 'users',
  referees: 'gavel',
  staff: 'briefcase',
  startOfDay: 'list-checks',
  clockReport: 'clock-3',
  live: 'radio',
  tournaments: 'trophy',
  pools: 'layout-grid',
  // Re-pairing every round is the thing a Swiss phase does that no other
  // format does; arrow-left-right would have read as the workspace switcher.
  swiss: 'shuffle',
  bracket: 'git-merge',
  finalRanking: 'list-ordered',
  penalties: 'triangle-alert',
  schedule: 'calendar-clock',
  statistics: 'chart-column',
  workshops: 'graduation-cap',
  compensation: 'banknote',
  notifications: 'bell',
  theme: 'palette',
  archive: 'archive',
  aiAssistant: 'bot',
  chat: 'message-square',
  profile: 'user',
  settings: 'settings',
  security: 'lock',
  switchWorkspace: 'arrow-left-right',
  logout: 'log-out',
};

/**
 * lucide's `defaultAttributes`, reproduced — including key ORDER, because
 * object spread keeps an overwritten key in its original slot and that is what
 * makes the emitted attribute order identical to the markup this replaced.
 * Changing any of these changes every sidebar glyph at once, which is the
 * reason they live in one place.
 */
const SVG_DEFAULTS = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Renders one vendored icon node. The lucide `<Icon>` component, minus the context. */
const Glyph = ({
  glyph,
  name,
  className,
  strokeWidth,
}: {
  glyph: IconNode;
  name: GlyphName;
  className: string;
  strokeWidth: number;
}) => (
  <svg
    {...SVG_DEFAULTS}
    strokeWidth={strokeWidth}
    className={`lucide lucide-${name} ${className}`.trim()}
    aria-hidden="true"
    focusable="false"
  >
    {glyph.map(([tag, attrs], index) => {
      // lucide carries React's `key` inside each node's attributes. Pulling it
      // out keeps it off the DOM element and out of a React 19 spread warning.
      const { key, ...rest } = attrs;
      return React.createElement(tag, { ...rest, key: key ?? String(index) });
    })}
  </svg>
);

export interface NavIconProps {
  name: NavIconName;
  /** Extra classes. Size defaults to `h-5 w-5`; pass a size to override. */
  className?: string;
}

export const NavIcon = ({ name, className = '' }: NavIconProps) => {
  const glyphName = NAV_ICON_GLYPHS[name];
  return (
    <Glyph
      glyph={LUCIDE_GLYPHS[glyphName]}
      name={glyphName}
      className={['h-5 w-5 shrink-0', className].join(' ')}
      strokeWidth={1.75}
    />
  );
};
