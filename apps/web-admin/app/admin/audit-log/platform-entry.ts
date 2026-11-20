/** One Platform log row as the API lists it (`admin-platform-log.service.ts`). */
export type PlatformLogCategory =
  | 'ai_scan'
  | 'ai_finding'
  | 'broadcast_failure'
  | 'club_review'
  | 'ai_usage'
  | 'ai_draft'
  | 'deletion'
  | 'merge'
  | 'club_archive'
  | 'query_error';

export type PlatformLogSeverity = 'info' | 'warning' | 'error';

export interface PlatformLogEntry {
  id: string;
  category: PlatformLogCategory;
  severity: PlatformLogSeverity;
  occurredAt: string;
  title: string | null;
  detail: string | null;
  /** Raw actor id — used only to distinguish unresolved-user from no-user; never rendered. */
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  href: string | null;
  /** Aggregated sources only (query_error today) — a count, formatted here. */
  occurrenceCount?: number;
  firstSeenAt?: string;
  resolvable?: boolean;
}

export const CATEGORIES: PlatformLogCategory[] = [
  'ai_scan',
  'ai_finding',
  'broadcast_failure',
  'club_review',
  'ai_usage',
  'ai_draft',
  'deletion',
  'merge',
  'club_archive',
];

export const SEVERITIES: PlatformLogSeverity[] = ['info', 'warning', 'error'];

export const SEVERITY_PILL: Record<PlatformLogSeverity, string> = {
  error: 'bg-danger/10 text-danger border border-danger/30',
  warning: 'bg-gold/10 text-gold-text',
  info: 'bg-background text-foreground-secondary',
};

export interface PlatformFilters {
  category: string;
  severity: string;
  from: string;
  to: string;
}

export const emptyFilters: PlatformFilters = { category: '', severity: '', from: '', to: '' };
