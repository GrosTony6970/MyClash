import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clashOf, clashWords, commitmentsOf } from './workshop-clash';
import type { PersonSchedule } from './types';

/**
 * The clash warning of a Workshop session, on both pages that book one
 * (operator ruling 270).
 *
 * Léa, a guest, fights in a Pool from 10:00 to 11:00. The personal Workshops
 * page, which only an account reaches, warned of a session at 10:30; the public
 * Workshop page, her only door, said nothing. Both now ask this module.
 */

const at = (hhmm: string) => `2027-05-22T${hhmm}:00.000Z`;

const WORDS: Record<string, string> = {
  'publicApp.me.schedule.referee': 'Referee',
  'publicApp.me.events.roleInstructor': 'Instructor',
  'publicApp.me.hub.kindQuarterFinal': 'Quarter-final',
  'publicApp.me.schedule.eliminationBlock': 'Elimination',
};
const t = (key: string) => WORDS[key] ?? `[${key}]`;

const bout = (
  id: string,
  start: string,
  minutes: number | null,
  poolId: string | null = null,
  over: Partial<PersonSchedule['matches'][number]> = {},
) =>
  ({
    id,
    scheduledAt: at(start),
    durationMinutes: minutes,
    fallbackEndsAt: null,
    poolId,
    poolName: poolId ? 'Pool A' : null,
    tournamentName: 'Longsword',
    phase: poolId ? 'pool' : null,
    opponentName: `opponent of ${id}`,
    roundCode: `M-${id}`,
    ...over,
  }) as unknown as PersonSchedule['matches'][number];

const duty = (
  id: string,
  start: string | null,
  end: string | null,
  over: Partial<PersonSchedule['refereeSlots'][number]> = {},
) =>
  ({
    id,
    roundCode: '',
    poolName: 'Pool B',
    tournamentName: null,
    matchKind: 'pool',
    scheduledAt: null,
    startsAt: start ? at(start) : null,
    endsAt: end ? at(end) : null,
    ...over,
  }) as unknown as PersonSchedule['refereeSlots'][number];

const schedule = (over: Partial<PersonSchedule>): PersonSchedule => ({
  personId: 'lea-row',
  matches: [],
  refereeSlots: [],
  workshops: null,
  ...over,
});

const session = (start: string | null, end: string | null) => ({
  id: 's-1',
  startsAt: start ? at(start) : null,
  endsAt: end ? at(end) : null,
});

describe('what the viewer already has to do', () => {
  it('is nothing for nobody', () => {
    expect(commitmentsOf(null, t)).toEqual({ commitments: [], unchecked: 0 });
  });

  it('holds the span of her Pool first, then her bouts, then her referee duties', () => {
    const { commitments, unchecked } = commitmentsOf(
      schedule({
        matches: [bout('b1', '10:00', 5, 'pool-a')],
        poolSpans: [
          {
            poolId: 'pool-a',
            poolName: 'Pool A',
            tournamentName: 'Longsword',
            startsAt: at('10:00'),
            endsAt: at('11:00'),
          },
        ] as PersonSchedule['poolSpans'],
        refereeSlots: [duty('d1', '14:00', '15:00')],
      }),
      t,
    );

    expect(commitments.map((c) => c.key)).toEqual(['pool-pool-a', 'fight-b1', 'ref-d1']);
    expect(commitments.map((c) => c.label)).toEqual([
      'Pool A · Longsword',
      'Pool A · Longsword',
      'Referee · Pool B',
    ]);
    expect(unchecked).toBe(0);
  });

  it('names a bracket bout by its block and a duty by its round, never by the opponent', () => {
    const { commitments } = commitmentsOf(
      schedule({
        matches: [bout('qf', '14:00', 10, null, { phase: 'bracket', phaseId: 'phase-b' })],
        refereeSlots: [
          duty('d1', '16:00', '16:10', {
            matchKind: 'quarter_final',
            poolName: null,
            tournamentName: 'Sabre',
            roundCode: 'SAB-QF-M2',
          }),
        ],
      }),
      t,
    );

    expect(commitments.map((c) => c.label)).toEqual([
      'Elimination · Longsword',
      'Referee · Quarter-final · Sabre',
    ]);
  });

  it('names a session inside her bracket by the whole bracket, before her own first bout', () => {
    // The bracket starts at 14:00 (operator, 2026-11-23); her bout is at 14:40.
    const { commitments } = commitmentsOf(
      schedule({
        matches: [bout('qf', '14:40', 10, null, { phase: 'bracket', phaseId: 'phase-b' })],
        phaseSpans: [
          {
            phaseId: 'phase-b',
            kind: 'bracket',
            tournamentName: 'Longsword',
            startsAt: at('14:00'),
            endsAt: at('18:00'),
          },
        ],
      }),
      t,
    );

    const clash = clashOf(session('14:05', '14:30'), commitments)!;
    expect(clashWords(clash, (iso) => iso.slice(11, 16))).toEqual({
      item: 'Elimination · Longsword',
      time: '14:00–18:00',
    });
  });

  it('names a bout with no block it can name by its code, beside the Tournament', () => {
    // A copy cached before the API sent the bout's phase.
    const { commitments } = commitmentsOf(
      schedule({
        matches: [
          bout('b1', '10:00', 5, null),
          bout('b2', '12:00', 5, null, { tournamentName: null }),
        ],
      }),
      t,
    );

    expect(commitments.map((c) => c.label)).toEqual(['M-b1 · Longsword', 'M-b2']);
  });

  it('counts a bout and a duty whose end is unknown: the check cannot see them', () => {
    const { commitments, unchecked } = commitmentsOf(
      schedule({
        matches: [bout('b1', '10:00', null)],
        refereeSlots: [duty('d1', '14:00', null)],
      }),
      t,
    );

    expect(commitments).toEqual([]);
    expect(unchecked).toBe(2);
  });
});

describe('a session against those commitments', () => {
  const { commitments } = commitmentsOf(
    schedule({
      matches: [bout('b1', '10:00', 5, 'pool-a')],
      poolSpans: [
        {
          poolId: 'pool-a',
          poolName: 'Pool A',
          tournamentName: null,
          startsAt: at('10:00'),
          endsAt: at('11:00'),
        },
      ] as PersonSchedule['poolSpans'],
    }),
    t,
  );

  it('clashes with the whole Pool, not only with her own bout in it', () => {
    expect(clashOf(session('10:30', '11:30'), commitments)?.label).toBe('Pool A');
  });

  it('names the whole Pool and its window when the session also meets her bout', () => {
    // The session covers her 10:00 bout: the line once read "opponent of b1 (10:00–10:05)".
    const clash = clashOf(session('09:30', '10:30'), commitments)!;
    expect(clashWords(clash, (iso) => iso.slice(11, 16))).toEqual({
      item: 'Pool A',
      time: '10:00–11:00',
    });
  });

  it('does not clash with a window that only touches it: the check is half-open', () => {
    expect(clashOf(session('11:00', '12:00'), commitments)).toBeNull();
    expect(clashOf(session('09:00', '10:00'), commitments)).toBeNull();
  });

  it.each([
    ['no start', session(null, '11:30')],
    ['no end', session('10:30', null)],
  ])('clashes with nothing when the session has %s', (_what, timeless) => {
    expect(clashOf(timeless, commitments)).toBeNull();
  });

  it('words the clash with its whole window', () => {
    const clash = clashOf(session('10:30', '11:30'), commitments)!;
    expect(clashWords(clash, (iso) => iso.slice(11, 16))).toEqual({
      item: 'Pool A',
      time: '10:00–11:00',
    });
  });
});

/**
 * Marie teaches "Demo Workshop 6" from 14:00 to 16:00. She booked Jean's 15:00 class and the
 * page said nothing: the check left out every Workshop, the ones she teaches too.
 */
describe('a session against the classes she teaches', () => {
  const taught = (
    id: string,
    start: string,
    end: string | null,
    sessionCancelled = false,
  ): NonNullable<PersonSchedule['teaching']>[number] => ({
    sessionId: id,
    workshopSlug: 'demo-6',
    workshopName: 'Demo Workshop 6',
    sessionStart: at(start),
    sessionEnd: end ? at(end) : null,
    location: null,
    sessionCancelled,
  });

  it('warns of a class she teaches at that hour, and names it as hers', () => {
    const { commitments } = commitmentsOf(
      schedule({ teaching: [taught('s-demo', '14:00', '16:00')] }),
      t,
    );
    const clash = clashOf(session('15:00', '17:00'), commitments)!;
    expect(clashWords(clash, (iso) => iso.slice(11, 16))).toEqual({
      item: 'Instructor · Demo Workshop 6',
      time: '14:00–16:00',
    });
  });

  it('holds nothing for a cancelled class, and counts a class with no end as unchecked', () => {
    const { commitments, unchecked } = commitmentsOf(
      schedule({
        teaching: [taught('s-off', '14:00', '16:00', true), taught('s-open', '18:00', null)],
      }),
      t,
    );
    expect(commitments).toEqual([]);
    expect(unchecked).toBe(1);
  });

  it('never warns a session of itself', () => {
    const { commitments } = commitmentsOf(
      schedule({ teaching: [taught('s-1', '14:00', '16:00')] }),
      t,
    );
    expect(clashOf(session('14:00', '16:00'), commitments)).toBeNull();
  });

  /** A seat (or a waitlist place) she already holds, as the schedule read sends it. */
  const booked = (
    id: string,
    start: string,
    end: string,
    over: Partial<NonNullable<PersonSchedule['workshops']>[number]> = {},
  ): NonNullable<PersonSchedule['workshops']>[number] => ({
    workshopId: id,
    workshopSlug: 'jean',
    workshopName: "Jean's class",
    sessionStart: at(start),
    sessionEnd: at(end),
    location: null,
    status: 'confirmed',
    sessionCancelled: false,
    instructorNames: ['Jean Dupont'],
    ...over,
  });

  it('warns of a session she already booked at that hour, a seat or a waitlist place', () => {
    for (const status of ['confirmed', 'waitlisted'] as const) {
      const { commitments } = commitmentsOf(
        schedule({ workshops: [booked('s-jean', '09:00', '11:00', { status })] }),
        t,
      );
      const clash = clashOf(session('10:00', '12:00'), commitments)!;
      expect(clashWords(clash, (iso) => iso.slice(11, 16))).toEqual({
        item: "Jean's class",
        time: '09:00–11:00',
      });
    }
  });

  it('holds nothing for a booked session that was cancelled, nor for the session itself', () => {
    const { commitments, unchecked } = commitmentsOf(
      schedule({
        workshops: [
          booked('s-off', '09:00', '11:00', { sessionCancelled: true }),
          booked('s-1', '14:00', '16:00'),
        ],
      }),
      t,
    );
    expect(clashOf(session('10:00', '12:00'), commitments)).toBeNull();
    // `session` is s-1: she booked it, and it does not warn of itself.
    expect(clashOf(session('14:00', '16:00'), commitments)).toBeNull();
    expect(unchecked).toBe(0);
  });

  it('counts a session she teaches and booked once, as her class', () => {
    const { commitments } = commitmentsOf(
      schedule({
        teaching: [taught('s-demo', '14:00', '16:00')],
        workshops: [booked('s-demo', '14:00', '16:00')],
      }),
      t,
    );
    expect(commitments.map((c) => c.label)).toEqual(['Instructor · Demo Workshop 6']);
  });

  it('reads a schedule cached before the API sent the classes as holding none', () => {
    expect(commitmentsOf(schedule({}), t)).toEqual({ commitments: [], unchecked: 0 });
  });
});

// web-public's vitest does not compile TSX: the pages are pinned as text.
const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

describe('the two pages that book a session warn the same way', () => {
  it.each([
    ['the personal Workshops page', 'app/me/events/[eventSlug]/workshops/page.tsx'],
    ['the public Workshop page', 'app/e/[eventSlug]/w/[workshopSlug]/page.tsx'],
  ])('%s asks the one owner, and hands the sentence to the controls', (_name, path) => {
    const page = source(path);
    expect(page).toMatch(/commitmentsOf\(\s*[\w.]+,\s*t\s*\)/);
    expect(page).toContain('const clash = clashOf(session, commitments);');
    expect(page).toMatch(
      /t\('publicApp\.me\.workshops\.conflictsWith', clashWords\(clash, fmtTime\)\)/,
    );
    expect(page).toContain('conflict={conflictFor(session)}');
    expect(page).toContain('<ClashCheckNotice count={unchecked} />');
  });
});
