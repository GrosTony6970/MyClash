'use client';

import * as React from 'react';
import {
  Archive,
  ArrowLeftRight,
  Banknote,
  Bell,
  Bot,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  Clock3,
  ListChecks,
  Cpu,
  DatabaseBackup,
  Flag,
  Gavel,
  GitMerge,
  Globe,
  GraduationCap,
  House,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ListOrdered,
  Lock,
  LogOut,
  MapPin,
  Medal,
  MessageSquare,
  Palette,
  Radio,
  ScanSearch,
  Scale,
  ScrollText,
  Server,
  Settings,
  Shield,
  Shuffle,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Swords,
  TrendingUp,
  TriangleAlert,
  Trophy,
  User,
  UserCheck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * NavIcon — the single glyph vocabulary for every MyClash sidebar.
 *
 * Names are SEMANTIC (`reviewQueue`), never the glyph's own name
 * (`clipboardCheck`), so swapping the artwork later is a one-line change here
 * and touches no call site. `Record<NavIconName, LucideIcon>` makes a missing
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
 * `'use client'` is not decoration: lucide 1.x icons read a context
 * (`useLucideContext`) on every render, so this is a hook-calling component and
 * a server component rendering it would throw. All four sidebars are already
 * client components; the directive keeps that true for the next caller.
 *
 * A slug may be reused across sidebars for the same concept (`leagues` covers
 * Leagues, My leagues and /me Leagues; `switchWorkspace` marks both the
 * web-admin `WorkspaceSwitcher` and web-public's link into it) — but never
 * twice inside one sidebar.
 *
 * BUNDLE COST — the named imports below are NOT tree-shaken. This package
 * compiles to CommonJS (`module: Node16`, tsconfig.lib.json), so webpack sees a
 * `require('lucide-react')` it cannot analyse and pulls the whole ~1500-icon
 * barrel: measured at +162 KB gzip across the web-admin chunks (first-load JS
 * is unaffected — the barrel lands in a shared chunk, not rootMainFiles, so the
 * 800 KB budget still passes). Accepted deliberately. The consequence worth
 * knowing: adding a 49th icon here is free, because the other 1499 already
 * shipped. Undoing it means either vendoring the path data or giving this
 * package an ESM output — not switching to `import Foo from 'lucide-react/…'`,
 * which lucide's CJS build (one bundled file, no per-icon modules) can't serve.
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

export const NAV_ICON_GLYPHS: Record<NavIconName, LucideIcon> = {
  overview: House,
  organizations: Building2,
  accounts: UserCog,
  globalProfiles: Globe,
  clubs: Shield,
  leagues: Medal,
  rulesets: Scale,
  weapons: Swords,
  reviewQueue: ClipboardCheck,
  frozenResults: Snowflake,
  pendingClaims: UserCheck,
  ratings: TrendingUp,
  system: Server,
  backups: DatabaseBackup,
  auditLog: ScrollText,
  ai: Sparkles,
  aiKeys: KeyRound,
  aiModels: Cpu,
  aiBudget: Wallet,
  dataQuality: ScanSearch,
  dataRetention: ShieldCheck,
  featureFlags: Flag,
  events: CalendarDays,
  members: Users,
  venues: MapPin,
  eventOverview: LayoutDashboard,
  persons: Users,
  referees: Gavel,
  staff: Briefcase,
  startOfDay: ListChecks,
  clockReport: Clock3,
  live: Radio,
  tournaments: Trophy,
  pools: LayoutGrid,
  // Re-pairing every round is the thing a Swiss phase does that no other
  // format does; ArrowLeftRight would have read as the workspace switcher.
  swiss: Shuffle,
  bracket: GitMerge,
  finalRanking: ListOrdered,
  penalties: TriangleAlert,
  schedule: CalendarClock,
  statistics: ChartColumn,
  workshops: GraduationCap,
  compensation: Banknote,
  notifications: Bell,
  theme: Palette,
  archive: Archive,
  aiAssistant: Bot,
  chat: MessageSquare,
  profile: User,
  settings: Settings,
  security: Lock,
  switchWorkspace: ArrowLeftRight,
  logout: LogOut,
};

export interface NavIconProps {
  name: NavIconName;
  /** Extra classes. Size defaults to `h-5 w-5`; pass a size to override. */
  className?: string;
}

export const NavIcon = ({ name, className = '' }: NavIconProps) => {
  const Glyph = NAV_ICON_GLYPHS[name];
  return (
    <Glyph
      className={['h-5 w-5 shrink-0', className].join(' ')}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
    />
  );
};
