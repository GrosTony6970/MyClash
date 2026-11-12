import type {
  AgreedSpar,
  IncomingSparRequest,
  SentSparRequest,
  SparFighter,
  SparKind,
  SparReview,
  SparStatus,
} from '@myclash/types';
import { sparWindows } from './spar-windows';

/** The `spar_requests` columns the FightBook reads select (`spar-reads.service.ts`). */
export interface SparRow {
  id: string;
  asker_global_person_id: string;
  receiver_global_person_id: string;
  kind: SparKind;
  event_id: string | null;
  spar_day: string;
  zone: string;
  spar_time: string | null;
  place: string | null;
  weapons: string[];
  message: string | null;
  status: SparStatus;
  expires_at: string;
  shared_comment: string | null;
  cancelled_by: 'asker' | 'receiver' | null;
  cancel_message: string | null;
}

/**
 * The status every reader sees. A request still waiting in the database after its end reads
 * "Not this time": the hourly job ends it soon, and until then nobody may tell it from a no.
 */
export function effectiveSparStatus(
  row: Pick<SparRow, 'status' | 'expires_at'>,
  now: Date,
): SparStatus {
  if (row.status === 'pending' && new Date(row.expires_at).getTime() <= now.getTime()) {
    return 'not_this_time';
  }
  return row.status;
}

/**
 * What a spar card shows of what was written after the spar (`SparThanksService.cardExtras`).
 * `theirThanks` is the partner's SIGNED thank-you only: an anonymous review never reaches its
 * subject's card.
 */
export interface SparCardExtras {
  myReview: SparReview | null;
  theirThanks: { stars: number; text: string | null } | null;
  note: string | null;
  /** The caller's own safety flag on this spar; the partner's flag about the caller never counts. */
  iFlagged: boolean;
}

/** A card nothing was written on yet, and the card a Yes builds. */
export const NO_EXTRAS: SparCardExtras = {
  myReview: null,
  theirThanks: null,
  note: null,
  iFlagged: false,
};

/** When and where, as a card says it. A time is wall clock, HH:MM. */
export function sparWhen(
  row: Pick<SparRow, 'kind' | 'event_id' | 'spar_day' | 'spar_time' | 'place' | 'weapons'>,
  eventName: string | null,
) {
  return {
    kind: row.kind,
    eventName: row.event_id ? eventName : null,
    day: row.spar_day,
    time: row.spar_time ? row.spar_time.slice(0, 5) : null,
    place: row.place,
    weapons: row.weapons,
  };
}

/** The after-the-spar windows (`sparWindows`), as the ISO instants a card carries. */
function windows(row: SparRow) {
  const { markFrom, markUntil, cancelUntil } = sparWindows(row);
  return {
    markFrom: markFrom.toISOString(),
    markUntil: markUntil.toISOString(),
    cancelUntil: cancelUntil.toISOString(),
  };
}

/** A request waiting for the caller's answer, with the windows a Yes turns into a spar card. */
export function toIncoming(
  row: SparRow,
  asker: SparFighter,
  eventName: string | null,
): IncomingSparRequest {
  return {
    id: row.id,
    asker,
    ...sparWhen(row, eventName),
    message: row.message,
    ...windows(row),
  };
}

/**
 * A request the caller sent. Built from nothing that differs between a decline, a block and a
 * request that ran out (no time, no reason): every "no" gives the same payload. The comment is
 * the one the decliner chose to show; a private one is never on the row.
 */
export function toSent(
  row: SparRow,
  receiver: SparFighter,
  eventName: string | null,
  now: Date,
): SentSparRequest {
  const status = effectiveSparStatus(row, now) === 'pending' ? 'pending' : 'not_this_time';
  return {
    id: row.id,
    receiver,
    ...sparWhen(row, eventName),
    message: row.message,
    status,
    comment: status === 'not_this_time' ? row.shared_comment : null,
  };
}

/**
 * A card's status: the three My spars reads (`SparReadsService.sparsOf`). Any other is a request
 * no card is built from, and throws; a status added to `SparStatus` fails the typecheck here.
 */
function cardStatus(status: SparStatus): AgreedSpar['status'] {
  switch (status) {
    case 'agreed':
    case 'cancelled':
    case 'done':
      return status;
    case 'pending':
    case 'not_this_time':
    case 'withdrawn':
      throw new Error(`spar card built from a ${status} request`);
    default: {
      const unread: never = status;
      throw new Error(`spar card built from an unknown status ${String(unread)}`);
    }
  }
}

/**
 * A spar both fighters agreed to, one either of them cancelled since, or one they marked done,
 * with what was written on it. `partnerFavourite` is null when the card has no heart: the caller
 * has FightBook off, or the partner is not someone they may ask (`SparReadsService.mySpars`).
 */
export function toAgreed(
  row: SparRow,
  me: string,
  partner: SparFighter,
  eventName: string | null,
  extras: SparCardExtras,
  partnerFavourite: boolean | null = null,
): AgreedSpar {
  const iAsked = row.asker_global_person_id === me;
  const cancelled = row.status === 'cancelled';
  return {
    id: row.id,
    partner,
    iAsked,
    ...sparWhen(row, eventName),
    message: row.message,
    status: cardStatus(row.status),
    cancelledByMe: cancelled ? row.cancelled_by === (iAsked ? 'asker' : 'receiver') : null,
    cancelMessage: cancelled ? row.cancel_message : null,
    ...windows(row),
    myReview: extras.myReview,
    theirThanks: extras.theirThanks,
    note: extras.note,
    partnerFavourite,
    iFlagged: extras.iFlagged,
  };
}
