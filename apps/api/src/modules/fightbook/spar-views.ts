import type {
  AgreedSpar,
  IncomingSparRequest,
  SentSparRequest,
  SparFighter,
  SparKind,
  SparStatus,
} from '@myclash/types';

/** The `spar_requests` columns the FightBook reads select (`spar-reads.service.ts`). */
export interface SparRow {
  id: string;
  asker_global_person_id: string;
  receiver_global_person_id: string;
  kind: SparKind;
  event_id: string | null;
  spar_day: string;
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

/** When and where, as a card says it. A time is wall clock, HH:MM. */
function when(row: SparRow, eventName: string | null) {
  return {
    kind: row.kind,
    eventName: row.event_id ? eventName : null,
    day: row.spar_day,
    time: row.spar_time ? row.spar_time.slice(0, 5) : null,
    place: row.place,
    weapons: row.weapons,
  };
}

/** A request waiting for the caller's answer. */
export function toIncoming(
  row: SparRow,
  asker: SparFighter,
  eventName: string | null,
): IncomingSparRequest {
  return { id: row.id, asker, ...when(row, eventName), message: row.message };
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
    ...when(row, eventName),
    message: row.message,
    status,
    comment: status === 'not_this_time' ? row.shared_comment : null,
  };
}

/** A spar both fighters agreed to, or one either of them cancelled since. */
export function toAgreed(
  row: SparRow,
  me: string,
  partner: SparFighter,
  eventName: string | null,
): AgreedSpar {
  const iAsked = row.asker_global_person_id === me;
  const cancelled = row.status === 'cancelled';
  return {
    id: row.id,
    partner,
    iAsked,
    ...when(row, eventName),
    message: row.message,
    status: cancelled ? 'cancelled' : 'agreed',
    cancelledByMe: cancelled ? row.cancelled_by === (iAsked ? 'asker' : 'receiver') : null,
    cancelMessage: cancelled ? row.cancel_message : null,
  };
}
