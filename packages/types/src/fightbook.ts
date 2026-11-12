/**
 * FightBook wire shapes (slice 1): what the API's `me/fightbook` routes answer and the web reads.
 * A Spar is one friendly, unscored meeting between two fighters (docs/HIERARCHY.md).
 */

export type SparKind = 'event' | 'free';

/** The words stored in `spar_requests.status`. */
export type SparStatus =
  'pending' | 'agreed' | 'done' | 'not_this_time' | 'withdrawn' | 'cancelled';

/** The other fighter on a card: no profile link, an unlisted fighter's page may not exist. */
export interface SparFighter {
  globalPersonId: string;
  name: string;
  photoUrl: string | null;
  /** The name of the fighter's club; null when they have none. */
  club: string | null;
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

/**
 * When each after-the-spar action is open, as ISO instants from the request's own columns. The web
 * compares them with its clock to show or hide a button; the API enforces them on its own.
 */
interface SparWindows {
  /** 00:00 of the spar day on the spar's own clock: "We sparred" opens. */
  markFrom: string;
  /** Two days after the day ends: "We sparred" and its undo close, a thank-you opens. */
  markUntil: string;
  /** The day's end: a cancel closes. */
  cancelUntil: string;
}

/** A request waiting for the caller's answer. */
export interface IncomingSparRequest extends SparWhen, SparWindows {
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

/** What the caller wrote about a spar. An anonymous review carries no text. */
export interface SparReview {
  stars: number;
  text: string | null;
  anonymous: boolean;
}

/** A spar both fighters agreed to, one either of them cancelled since, or one they marked done. */
export interface AgreedSpar extends SparWhen, SparWindows {
  id: string;
  partner: SparFighter;
  iAsked: boolean;
  message: string | null;
  status: 'agreed' | 'cancelled' | 'done';
  /** Null unless cancelled. */
  cancelledByMe: boolean | null;
  cancelMessage: string | null;
  /** The caller's own thank-you or anonymous review; null before they write one. */
  myReview: SparReview | null;
  /** The partner's SIGNED thank-you to the caller. An anonymous review is never here. */
  theirThanks: { stars: number; text: string | null } | null;
  /** The caller's private note; only its writer reads it. */
  note: string | null;
  /** Null when no heart shows: the caller has FightBook off, or may not ask the partner. */
  partnerFavourite: boolean | null;
}

/** A signed thank-you the caller received, with who wrote it and the spar's when and where. */
export interface ThankYou extends SparWhen {
  id: string;
  from: SparFighter;
  stars: number;
  text: string | null;
}

/** One page of the thank-yous the caller received, newest first; `more` when a further page has one. */
export interface ThanksPage {
  items: ThankYou[];
  more: boolean;
}

export interface MySpars {
  spars: AgreedSpar[];
  sent: SentSparRequest[];
}

/** The star average over every review a fighter received, and how many there are (at least 1). */
export interface SparStars {
  average: number;
  count: number;
}

/**
 * The only FightBook data on a fighter's public page (rulings 682, 689): how many spars they did,
 * and their stars when they switched those on and have at least one review.
 */
export interface PublicSparLine {
  sparred: number;
  stars: SparStars | null;
}

export interface FightBookSettings {
  hasProfile: boolean;
  enabled: boolean;
  /** Whether the stars show on the public page (off by default). */
  showStars: boolean;
  /** Spars done, as the public page counts them; null when the count could not be read. */
  sparred: number | null;
  /** The caller's own average, whatever the switch; null before the first review, or unread. */
  stars: SparStars | null;
}

/** A published Event the fighter is on, with the days still open to ask for, on the Event's clock. */
export interface FightBookEvent {
  id: string;
  name: string;
  /** `YYYY-MM-DD`, oldest first. */
  days: string[];
  /** The latest open day that has started; null before the first day starts. */
  today: string | null;
}

export interface FightBookBlock {
  fighter: SparFighter;
}

/** A fighter the caller may ask, on the Find tab: who, and up to three declared weapons. */
export interface FindCard {
  fighter: SparFighter;
  /** Weapon names, favourites first, at most 3. */
  weapons: string[];
  /** Is this fighter in the caller's favourites (a private heart, ruling 679)? */
  favourite: boolean;
}

/** May the caller ask this fighter for a spar, and have they hearted them (profile page)? */
export interface FightBookAskable {
  askable: boolean;
  favourite: boolean;
}

/** One page of all of FightBook; `more` when a further page has someone on it. */
export interface FindPage {
  items: FindCard[];
  more: boolean;
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
  'bad_zone',
  'bad_place',
  'bad_weapon',
  'bad_event',
  'bad_answer',
  'self',
  'favourites_full',
] as const;

export type SparRefusalCode = (typeof SPAR_REFUSAL_CODES)[number];
