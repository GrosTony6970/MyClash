/**
 * status-help.ts — which status vocabularies can explain themselves, and how
 * to look that explanation up.
 *
 * Status chips are coloured everywhere and explained nowhere: nothing tells a
 * user what "Draft" means, what moves it on, or who is allowed to move it.
 * `StatusHelp` fills that in beside the chip; this module decides whether
 * there is anything to say.
 *
 * ── Why presence is READ from the messages ──────────────────────────────────
 *
 * A hand-kept list of "statuses we have copy for" would drift the moment a
 * status is added, and the failure would be visible to users as a literal
 * `[statusHelp.tournament.cancelled.means]` in a tooltip. So presence is
 * derived from the EN message tree itself, which cannot drift from the copy it
 * describes. EN is the source of truth; the i18n parity test already
 * guarantees FR carries the same leaves.
 */
// Just the one namespace, not the composed dictionary. packages/ui is a single
// CJS barrel with no tree-shaking, so importing `en` from '@myclash/i18n' here
// put all 15 namespaces in both locales into every app that touches any UI
// component — 181KB gzip on every page, which is exactly what the per-surface
// split exists to stop.
import { statusHelp } from '@myclash/i18n/messages/en/statusHelp';

/**
 * Status vocabularies that carry help copy.
 *
 * Deliberately NOT every string the per-domain mappers in `status-pill.ts`
 * accept. `matchStatusSemantic` handles 'ready', 'forfeit' and 'disqualified',
 * but `matches.status` is CHECK-constrained to
 * ('scheduled','running','paused','completed','voided') — writing copy for a
 * value the column cannot hold would be explaining a state that never appears.
 */
export type StatusHelpDomain =
  | 'event'
  | 'tournament'
  | 'match'
  | 'workshop'
  | 'registration'
  | 'review'
  | 'phaseVisibility'
  | 'clock'
  | 'ruleset'
  | 'organization';

/** The three questions a status chip should be able to answer. */
export interface StatusHelpKeys {
  means: string;
  next: string;
  who: string;
}

/**
 * i18n keys for one (domain, status) pair.
 *
 * The prefix is written inline rather than hoisted into a constant so the
 * i18n reverse sweep's automatic template-prefix detection picks up
 * `statusHelp.` — a `${BASE}.…` composition starts with the interpolation and
 * would need a MANUAL_PREFIXES entry to avoid being reported as orphaned.
 */
export function statusHelpKeys(domain: StatusHelpDomain, status: string): StatusHelpKeys {
  return {
    means: `statusHelp.${domain}.${status}.means`,
    next: `statusHelp.${domain}.${status}.next`,
    who: `statusHelp.${domain}.${status}.who`,
  };
}

/**
 * True when all three fields exist for this pair, so a chip never renders an
 * ⓘ that opens onto nothing (or onto raw key names).
 */
export function hasStatusHelp(domain: string, status: string): boolean {
  const domainNode: unknown = statusHelp;
  if (!isRecord(domainNode)) return false;
  const statuses = domainNode[domain];
  if (!isRecord(statuses)) return false;
  const fields = statuses[status];
  if (!isRecord(fields)) return false;
  return (
    typeof fields['means'] === 'string' &&
    typeof fields['next'] === 'string' &&
    typeof fields['who'] === 'string'
  );
}

/** Every status with help copy in a domain — used by tests and the showcase. */
export function statusesWithHelp(domain: StatusHelpDomain): string[] {
  const domainNode: unknown = statusHelp;
  if (!isRecord(domainNode)) return [];
  const statuses = domainNode[domain];
  if (!isRecord(statuses)) return [];
  return Object.keys(statuses).filter((status) => hasStatusHelp(domain, status));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
