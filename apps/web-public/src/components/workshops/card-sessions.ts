// Which sessions a Workshop card speaks of, and how (rulings 515, 526). Framework-free so the
// counts are tested without rendering the card.

import { isCancelledSession } from './session-cancelled';

interface CardSession {
  id: string;
  startsAt: string | null;
  status?: string | null;
}

export interface CardSessions<S extends CardSession> {
  /** The sessions that run: their seats, and "N sessions". */
  live: S[];
  /** The earliest session that runs: the card's time line. */
  first: S | null;
  /** "+N more": the other dated sessions that run. */
  more: number;
  /** A struck-through line each, unless a footer lists every session (the personal page). */
  cancelled: S[];
}

const byStart = (a: CardSession, b: CardSession) => (a.startsAt! < b.startsAt! ? -1 : 1);

export function cardSessions<S extends CardSession>(
  sessions: readonly S[],
  footerListsSessions: boolean,
): CardSessions<S> {
  const live = sessions.filter((s) => !isCancelledSession(s));
  const dated = live.filter((s) => s.startsAt).sort(byStart);
  const cancelled = footerListsSessions
    ? []
    : sessions.filter((s) => s.startsAt && isCancelledSession(s)).sort(byStart);
  return { live, first: dated[0] ?? null, more: Math.max(0, dated.length - 1), cancelled };
}
