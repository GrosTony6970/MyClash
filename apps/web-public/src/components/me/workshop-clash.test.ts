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

const bout = (id: string, start: string, minutes: number | null, poolId: string | null = null) =>
  ({
    id,
    scheduledAt: at(start),
    durationMinutes: minutes,
    fallbackEndsAt: null,
    poolId,
    opponentName: `opponent of ${id}`,
    matchNumberLabel: `M-${id}`,
  }) as unknown as PersonSchedule['matches'][number];

const duty = (id: string, start: string | null, end: string | null) =>
  ({
    id,
    matchNumberLabel: '',
    poolName: 'Pool B',
    scheduledAt: null,
    startsAt: start ? at(start) : null,
    endsAt: end ? at(end) : null,
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
    expect(commitmentsOf(null, 'Referee')).toEqual({ commitments: [], unchecked: 0 });
  });

  it('holds her bouts, the span of her Pool and her referee duties', () => {
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
      'Referee',
    );

    expect(commitments.map((c) => c.label)).toEqual([
      'opponent of b1',
      'Pool A · Longsword',
      'Referee · Pool B',
    ]);
    expect(unchecked).toBe(0);
  });

  it('counts a bout and a duty whose end is unknown: the check cannot see them', () => {
    const { commitments, unchecked } = commitmentsOf(
      schedule({
        matches: [bout('b1', '10:00', null)],
        refereeSlots: [duty('d1', '14:00', null)],
      }),
      'Referee',
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
    'Referee',
  );

  it('clashes with the whole Pool, not only with her own bout in it', () => {
    expect(clashOf(session('10:30', '11:30'), commitments)?.label).toBe('Pool A');
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

// web-public's vitest does not compile TSX: the pages are pinned as text.
const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

describe('the two pages that book a session warn the same way', () => {
  it.each([
    ['the personal Workshops page', 'app/me/events/[eventSlug]/workshops/page.tsx'],
    ['the public Workshop page', 'app/e/[eventSlug]/w/[workshopSlug]/page.tsx'],
  ])('%s asks the one owner, and hands the sentence to the controls', (_name, path) => {
    const page = source(path);
    expect(page).toMatch(
      /commitmentsOf\(\s*[\w.]+,\s*t\('publicApp\.me\.schedule\.referee'\),?\s*\)/,
    );
    expect(page).toContain('const clash = clashOf(session, commitments);');
    expect(page).toMatch(
      /t\('publicApp\.me\.workshops\.conflictsWith', clashWords\(clash, fmtTime\)\)/,
    );
    expect(page).toContain('conflict={conflictFor(session)}');
    expect(page).toContain('<ClashCheckNotice count={unchecked} />');
  });
});
