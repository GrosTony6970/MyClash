/**
 * Presentation mapping for the event readiness checklist: a check key + level
 * from `GET /events/:eventId/readiness` into the i18n key, the palette tone,
 * and the page that actually fixes it.
 *
 * Kept beside the panel and free of React, following the `columnHelp.ts`
 * pattern: the copy lives in i18n, the mapping is data, and both are testable
 * without rendering anything. A readiness row whose "Fix" link went to the
 * wrong page would be worse than no link at all, so the routes are pinned by
 * tests rather than typed inline in JSX.
 */
import type { StatusSemantic } from '@myclash/ui';
import { withTournament } from '@/lib/tournament-choice';

export type ReadinessLevel = 'ok' | 'warn' | 'critical' | 'info';

export interface ReadinessCheck {
  key: string;
  level: ReadinessLevel;
  values?: Record<string, string | number>;
  tournamentId: string | null;
}

export interface ReadinessReport {
  eventId: string;
  eventStatus: string;
  tournaments: Array<{ id: string; name: string }>;
  checks: ReadinessCheck[];
  worst: ReadinessLevel;
  counts: Record<ReadinessLevel, number>;
}

/**
 * Readiness levels borrow the canonical status palette rather than inventing
 * colours: critical reads as danger, warn as the amber "needs a look" tone,
 * ok as the completed green, info as neutral blue.
 */
export function readinessSemantic(level: ReadinessLevel): StatusSemantic {
  switch (level) {
    case 'critical':
      return 'danger';
    case 'warn':
      return 'paused';
    case 'ok':
      return 'done';
    case 'info':
    default:
      return 'ready';
  }
}

export interface ReadinessMark {
  /** The symbol inside the mark. Its shape tells the levels apart without colour. */
  glyph: string;
  /** The mark's fill and ink: the SOLID status token, never the pale chip palette. */
  markClassName: string;
  /** The row's flag: an edge and a light wash on a row with work left, nothing otherwise. */
  rowClassName: string;
}

/**
 * How a level looks on a checklist row.
 *
 * The row mark used to borrow the chip palette (`bg-emerald-50 border-emerald-200`). That palette
 * sits BEHIND words, so a 10 px dot painted with it came out almost white, and an organiser could
 * not tell a cleared row from one with work left. The mark is a solid disc in the theme's status
 * colour, with the glyphs the toasts already use.
 *
 * A flagged row's wash is 5 %: every status ink clears 4.5:1 on its own 15 % wash, and the row
 * puts its message in the secondary ink, never the muted one (known-deviations D35).
 */
export function readinessMark(level: ReadinessLevel): ReadinessMark {
  switch (level) {
    case 'critical':
      return {
        glyph: '✕',
        markClassName: 'bg-danger text-danger-foreground',
        rowClassName: 'border-l-4 border-l-danger bg-danger/5',
      };
    case 'warn':
      return {
        glyph: '!',
        markClassName: 'bg-warning text-warning-foreground',
        rowClassName: 'border-l-4 border-l-warning bg-warning/5',
      };
    case 'ok':
      return { glyph: '✓', markClassName: 'bg-success text-success-foreground', rowClassName: '' };
    case 'info':
      return { glyph: 'i', markClassName: 'bg-info text-info-foreground', rowClassName: '' };
  }
}

/** Levels that represent outstanding work, worst first. */
export const OUTSTANDING_LEVELS: ReadinessLevel[] = ['critical', 'warn'];

export function isOutstanding(check: ReadinessCheck): boolean {
  return OUTSTANDING_LEVELS.includes(check.level);
}

/**
 * The event sub-page that resolves each check. `pistes` points at the schedule
 * board because that is where lices are created; `format` points at pools,
 * which is where a tournament's first phase gets generated.
 */
const FIX_ROUTE: Record<string, string> = {
  tournaments: 'tournaments',
  pistes: 'schedule',
  fighters: 'persons',
  // A team Tournament's entrants are its teams, made on the Teams page.
  teams: 'teams',
  format: 'pools',
  pools: 'pools',
  poolReferees: 'referees',
  schedule: 'schedule',
  bracket: 'bracket',
  swissRounds: 'swiss',
  // All three roster-quality rows are fixed in the same place — the participant
  // list is where a club is set, an identity is relinked and a rating id is
  // entered. They stay separate CHECKS because they are separate questions with
  // different urgency, not because they lead anywhere different.
  rosterIdentity: 'persons',
  rosterClub: 'persons',
  rosterRatings: 'persons',
};

/**
 * Where to send someone to clear a check. `ruleset` is per-tournament settings
 * rather than an event page, so it needs the tournament id; every other route
 * is event-wide. Returns `null` for a check with no sensible destination.
 */
export function readinessFixHref(
  check: ReadinessCheck,
  slug: string,
  eventId: string,
): string | null {
  const base = `/org/${slug}/events/${eventId}`;
  if (check.key === 'ruleset') {
    return check.tournamentId ? `${base}/tournaments/${check.tournamentId}/settings` : null;
  }
  const route = FIX_ROUTE[check.key];
  return route ? withTournament(`${base}/${route}`, check.tournamentId ?? '') : null;
}

/**
 * i18n key for a row's short label (`Referees`, `Schedule`, …).
 *
 * Written as an inline template so the reverse-sweep's automatic
 * template-prefix detection picks up `organizer.readiness.check.` — hoisting
 * the prefix into a constant would hide it and require a MANUAL_PREFIXES entry.
 */
export function readinessLabelKey(check: ReadinessCheck): string {
  return `organizer.readiness.check.${check.key}.label`;
}

/** i18n key for the row's message, which differs per level. */
export function readinessMessageKey(check: ReadinessCheck): string {
  return `organizer.readiness.check.${check.key}.${check.level}`;
}
