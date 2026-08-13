import type { Translator } from '@myclash/next-i18n/client';

type T = Translator;

/**
 * Every value the `match_status_check` constraint allows
 * (packages/db/migrations/0001_init.sql). The board renders `matches.status`
 * straight from the API, so anything outside this set is a schema change we
 * have not caught up with yet.
 */
const KNOWN_MATCH_STATUSES = new Set(['scheduled', 'running', 'paused', 'completed', 'voided']);

/**
 * Translate a raw `matches.status` for display.
 *
 * Unknown values pass through verbatim rather than resolving a missing key.
 * The guard is a known-set check and NOT a `t(key) ?? status` fallback on
 * purpose: a fallback inside `t()` would also swallow a key that exists in EN
 * but is missing in FR, shipping the raw enum to French organizers with no
 * gate to catch it. This way the i18n forward test still fails on a missing
 * translation, and only a genuinely new DB status degrades to raw text.
 */
export function matchStatusLabel(status: string, t: T): string {
  return KNOWN_MATCH_STATUSES.has(status) ? t(`organizer.live.matchStatus.${status}`) : status;
}
