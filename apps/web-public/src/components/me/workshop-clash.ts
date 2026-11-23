// "Does this Workshop session clash with what the viewer already has to do?", for
// the two pages that book a session: the personal Workshops page and the public
// Workshop page (operator ruling 270). Warn, never block: the button then reads
// "Register anyway". Kept framework-free so it can be unit-tested in isolation.

import type { Translator } from '@myclash/next-i18n/client';
import { overlapsHalfOpen } from '@myclash/schedule-core';
import { dutyTimed, fightItems, toTimed, uncheckedCount, type TimedItem } from './conflicts';
import { matchKindLabel } from './match-kind';
import type { PersonSchedule } from './types';

/** What a bout or a duty is, as the clash line names it: the Pool, or the round. */
interface Commitment {
  roundCode: string;
  poolName: string | null;
  tournamentName: string | null;
  matchKind?: string | null;
  roundOfCount?: number | null;
  swissRound?: number | null;
}

/**
 * "Pool 1 · Longsword Open" or "Quarter-final · Longsword Open" — never the opponent: the reader
 * wants to know which part of the Tournament holds them (operator, 2026-11-23). A Pool is named
 * by its own name; a bout outside one by its round. The bout's code is the last resort.
 */
function commitmentLabel(t: Translator, c: Commitment): string {
  const inPool = c.matchKind === 'pool' || (c.matchKind == null && c.poolName !== null);
  const what = inPool
    ? c.poolName
    : matchKindLabel(t, c.matchKind ?? null, c.roundOfCount ?? null, c.swissRound ?? null);
  return [what, c.tournamentName].filter(Boolean).join(' · ') || c.roundCode;
}

/**
 * The viewer's fights, the Pools they fight in, and their referee duties as timed
 * windows, for conflict checks — and how many fights and duties the check cannot
 * see. A duty's window is the one the API works out, so a Pool duty (no Match of
 * its own) takes part too; an item whose end is unknown does not. Workshops stay
 * out: every enrolled session would clash with itself.
 *
 * A Pool's span comes first: `clashOf` names the first overlap, and a session that
 * meets one bout of a Pool meets the Pool too, so it names the whole Pool and its
 * whole window rather than one five-minute bout.
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
  const fights = fightItems(schedule, boutKey, (m) => commitmentLabel(t, m));
  const commitments = [
    ...fights.filter((item) => item.spanOf !== undefined),
    ...fights.filter((item) => item.spanOf === undefined),
    ...schedule.refereeSlots.flatMap((r) => {
      const what = commitmentLabel(t, r);
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
