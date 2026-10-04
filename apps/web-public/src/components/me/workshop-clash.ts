// "Does this Workshop session clash with what the viewer already has to do?", for
// the two pages that book a session: the personal Workshops page and the public
// Workshop page (operator ruling 270). Warn, never block: the button then reads
// "Register anyway". Kept framework-free so it can be unit-tested in isolation.

import { overlapsHalfOpen } from '@myclash/schedule-core';
import { dutyTimed, fightItems, toTimed, uncheckedCount, type TimedItem } from './conflicts';
import type { PersonSchedule } from './types';

/**
 * The viewer's fights, the Pools they fight in, and their referee duties as timed
 * windows, for conflict checks — and how many fights and duties the check cannot
 * see. A duty's window is the one the API works out, so a Pool duty (no Match of
 * its own) takes part too; an item whose end is unknown does not. Workshops stay
 * out: every enrolled session would clash with itself.
 *
 * Nobody (no schedule) has no commitment, and nothing unchecked.
 */
export function commitmentsOf(
  schedule: PersonSchedule | null,
  referee: string,
): { commitments: TimedItem[]; unchecked: number } {
  if (!schedule) return { commitments: [], unchecked: 0 };
  const boutKey = (m: PersonSchedule['matches'][number]) => `fight-${m.id}`;
  const dutyKey = (r: PersonSchedule['refereeSlots'][number]) => `ref-${r.id}`;
  const commitments = [
    ...fightItems(schedule, boutKey, (m) => m.opponentName ?? m.matchNumberLabel),
    ...schedule.refereeSlots.flatMap((r) => {
      const what = r.matchNumberLabel || r.poolName;
      const ti = dutyTimed(dutyKey(r), what ? `${referee} · ${what}` : referee, r);
      return ti ? [ti] : [];
    }),
  ];
  const cards = [
    ...schedule.matches.map((m) => ({ key: boutKey(m), time: m.scheduledAt })),
    ...schedule.refereeSlots.map((r) => ({ key: dutyKey(r), time: r.scheduledAt ?? r.startsAt })),
  ];
  return { commitments, unchecked: uncheckedCount(cards, commitments) };
}

/**
 * The first commitment a session overlaps, or null. A session with no readable
 * start and end has no window, and clashes with nothing.
 */
export function clashOf(
  session: { id: string; startsAt: string | null; endsAt: string | null },
  commitments: readonly TimedItem[],
): TimedItem | null {
  const window = toTimed(`ws-${session.id}`, '', session.startsAt, session.endsAt);
  if (!window) return null;
  return commitments.find((commitment) => overlapsHalfOpen(window, commitment)) ?? null;
}

/**
 * The clash as the pages word it: what it is, and its WHOLE window, not its start.
 * A Pool that starts at 10:00 and clashes with a 10:31 session would read as no
 * clash at "(10:00)".
 */
export function clashWords(
  clash: TimedItem,
  time: (iso: string) => string,
): { item: string; time: string } {
  const at = (ms: number) => time(new Date(ms).toISOString());
  return { item: clash.label, time: `${at(clash.startMs)}–${at(clash.endMs)}` };
}
