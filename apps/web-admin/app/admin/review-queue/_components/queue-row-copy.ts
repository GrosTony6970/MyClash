import type { ReviewQueueItem } from '../_types';

/**
 * What a review queue row says that is not data: the Type badge and the age.
 *
 * Both were English literals in the row. Pure and free of React, so the mapping
 * is pinned by tests. Literal keys, never composed: the i18n sweep resolves a
 * dotted string literal.
 */
export interface TypeBadge {
  color: string;
  labelKey: string;
}

/**
 * An exchange correction says what it asks of the hit: "void" and "restore" are
 * opposite decisions, and the reviewer read one word for both.
 */
export function typeBadge(item: Pick<ReviewQueueItem, 'type' | 'exchangeAction'>): TypeBadge {
  switch (item.type) {
    case 'deletion':
      return { color: 'blue', labelKey: 'admin.reviewQueue.typeDeletion' };
    case 'exchange_edit':
      return {
        color: 'purple',
        labelKey:
          item.exchangeAction === 'revert_void_exchange'
            ? 'admin.reviewQueue.typeExchangeRestore'
            : 'admin.reviewQueue.typeExchangeVoid',
      };
    case 'club_review':
      return { color: 'green', labelKey: 'admin.reviewQueue.typeClubReview' };
    case 'league_tournament_request':
      return { color: 'red', labelKey: 'admin.reviewQueue.typeLeagueTournamentRequest' };
    case 'league_membership_request':
      return { color: 'red', labelKey: 'admin.reviewQueue.typeLeagueMembershipRequest' };
  }
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago a request was made, in the reader's language. `Intl` holds the
 * plurals of each language; `t()` has none.
 */
export function ageOf(createdAt: string, bcp47: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  const say = new Intl.RelativeTimeFormat(bcp47, { numeric: 'always' });
  if (seconds < MINUTE) return say.format(-seconds, 'second');
  if (seconds < HOUR) return say.format(-Math.floor(seconds / MINUTE), 'minute');
  if (seconds < DAY) return say.format(-Math.floor(seconds / HOUR), 'hour');
  return say.format(-Math.floor(seconds / DAY), 'day');
}
