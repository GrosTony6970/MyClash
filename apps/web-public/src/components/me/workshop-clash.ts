// "Does this Workshop session clash with what the viewer already has to do?", for
// the two pages that book a session: the personal Workshops page and the public
// Workshop page (operator ruling 270). Warn, never block: the button then reads
// "Register anyway". Kept framework-free so it can be unit-tested in isolation.

import type { Translator } from '@myclash/next-i18n/client';
import { overlapsHalfOpen } from '@myclash/schedule-core';
import {
  dutyTimed,
  fightItems,
  toTimed,
  uncheckedCount,
  workshopTimed,
  type TimedItem,
} from './conflicts';
import { matchKindLabel } from './match-kind';
import { scheduleWorkshops } from './schedule-model';
import type { PersonSchedule } from './types';

type Duty = Pick<
  PersonSchedule['refereeSlots'][number],
  'roundCode' | 'poolName' | 'tournamentName' | 'matchKind' | 'roundOfCount' | 'swissRound'
>;

/**
 * What a referee duty is, as the clash line names it: "Pool 1 · Longsword Open" or
 * "Quarter-final · Longsword Open" (operator, 2026-11-23). A Pool is named by its own name; a
 * duty outside one by its round. A round with no words of its own (a bracket of unknown size) is
 * named by the bout's code, so the line never shrinks to the Tournament alone. A fighter's own
 * bouts are named by their block (`blockLabel`).
 */
function dutyLabel(t: Translator, c: Duty): string {
  const inPool = c.matchKind === 'pool' || (c.matchKind == null && c.poolName !== null);
  const what = inPool ? c.poolName : matchKindLabel(t, c.matchKind, c.roundOfCount, c.swissRound);
  return [what || c.roundCode, c.tournamentName].filter(Boolean).join(' · ');
}

/**
 * The viewer's fights, the blocks they fight in, their referee duties and their Workshop
 * sessions — the ones they teach and the ones they booked, a seat or a waitlist place, as
 * the Schedule tab lists them (`scheduleWorkshops`) — as timed windows, for conflict checks,
 * and how many of them the check cannot see. A duty's window is the one the API works out,
 * so a Pool duty (no Match of its own) takes part too; an item whose end is unknown does not.
 * A cancelled session holds nothing (ruling 529). A session never clashes with itself
 * (`clashOf`), and the controls show no warning on a session already booked.
 *
 * The block spans come first (`fightItems`): `clashOf` names the first overlap, so a
 * session inside a Pool or a bracket names the whole block and its whole window.
 *
 * Nobody (no schedule) has no commitment, and nothing unchecked.
 */
export function commitmentsOf(
  schedule: PersonSchedule | null,
  t: Translator,
): { commitments: TimedItem[]; unchecked: number } {
  if (!schedule) return { commitments: [], unchecked: 0 };
  const referee = t('publicApp.me.schedule.referee');
  const boutKey = (m: PersonSchedule['matches'][number]) => `fight-${m.id}`;
  const dutyKey = (r: PersonSchedule['refereeSlots'][number]) => `ref-${r.id}`;
  const instructor = t('publicApp.me.events.roleInstructor');
  const workshops = scheduleWorkshops(schedule);
  const commitments = [
    ...fightItems(schedule, boutKey, t),
    ...schedule.refereeSlots.flatMap((r) => {
      const what = dutyLabel(t, r);
      const ti = dutyTimed(dutyKey(r), what ? `${referee} · ${what}` : referee, r);
      return ti ? [ti] : [];
    }),
    // "Instructor · Demo Workshop 6" for a class she teaches; a booked session by its name.
    ...workshops.flatMap((w) => {
      const name = w.role === 'teaching' ? `${instructor} · ${w.workshopName}` : w.workshopName;
      const ti = workshopTimed(w.key, name, w);
      return ti ? [ti] : [];
    }),
  ];
  const cards = [
    ...schedule.matches.map((m) => ({ key: boutKey(m), time: m.scheduledAt })),
    ...schedule.refereeSlots.map((r) => ({ key: dutyKey(r), time: r.scheduledAt ?? r.startsAt })),
    // A cancelled session will not run: nothing for the check to miss (ruling 529).
    ...workshops.map((w) => ({ key: w.key, time: w.sessionCancelled ? null : w.sessionStart })),
  ];
  return { commitments, unchecked: uncheckedCount(cards, commitments) };
}

/**
 * The first commitment a session overlaps, or null. A session with no readable
 * start and end has no window, and clashes with nothing; nor does a session clash
 * with itself (one she booked or teaches, on her own Workshops page).
 */
export function clashOf(
  session: { id: string; startsAt: string | null; endsAt: string | null },
  commitments: readonly TimedItem[],
): TimedItem | null {
  const window = toTimed(`ws-${session.id}`, '', session.startsAt, session.endsAt);
  if (!window) return null;
  return (
    commitments.find(
      (commitment) => commitment.key !== window.key && overlapsHalfOpen(window, commitment),
    ) ?? null
  );
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
