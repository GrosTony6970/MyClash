/**
 * FightBook wire shapes (slice 1): what the API's `me/fightbook` routes answer and the web reads.
 * A Spar is one friendly, unscored meeting between two fighters (docs/HIERARCHY.md).
 */

export type SparKind = 'event' | 'free';

/** The words stored in `spar_requests.status`. */
export type SparStatus = 'pending' | 'agreed' | 'not_this_time' | 'withdrawn' | 'cancelled';

/** The other fighter on a card: no profile link, an unlisted fighter's page may not exist. */
export interface SparFighter {
  globalPersonId: string;
  name: string;
  photoUrl: string | null;
}

/** When and where: an Event day, or a free date and place. Day and time are wall clock. */
interface SparWhen {
  kind: SparKind;
  /** Null for a free date, and for an Event since deleted. */
  eventName: string | null;
  day: string;
  time: string | null;
  place: string | null;
  weapons: string[];
}

/** A request waiting for the caller's answer. */
export interface IncomingSparRequest extends SparWhen {
  id: string;
  asker: SparFighter;
  message: string | null;
}

/**
 * A request the caller sent. Every "no" reads `not_this_time`, whichever way it happened, and
 * `comment` is set only when the decliner chose to show it. Withdrawn requests are not listed.
 */
export interface SentSparRequest extends SparWhen {
  id: string;
  receiver: SparFighter;
  message: string | null;
  status: 'pending' | 'not_this_time';
  comment: string | null;
}

/** A spar both fighters agreed to, or one either of them cancelled since. */
export interface AgreedSpar extends SparWhen {
  id: string;
  partner: SparFighter;
  iAsked: boolean;
  message: string | null;
  status: 'agreed' | 'cancelled';
  /** Null while agreed. */
  cancelledByMe: boolean | null;
  cancelMessage: string | null;
}

export interface MySpars {
  spars: AgreedSpar[];
  sent: SentSparRequest[];
}

export interface FightBookSettings {
  hasProfile: boolean;
  enabled: boolean;
}

export interface FightBookBlock {
  fighter: SparFighter;
}

/** The `code` of every FightBook refusal; the web turns each into its own sentence. */
export const SPAR_REFUSAL_CODES = [
  'no_profile',
  'fightbook_off',
  'not_on_fightbook',
  'already_asked',
  'not_again',
  'you_blocked',
  'not_open',
  'bad_day',
  'bad_event',
  'bad_answer',
  'self',
] as const;

export type SparRefusalCode = (typeof SPAR_REFUSAL_CODES)[number];
