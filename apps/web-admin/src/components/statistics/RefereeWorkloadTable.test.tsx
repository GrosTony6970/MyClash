import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RefereeWorkloadTable } from './RefereeWorkloadTable';
import type { RefereeWorkloadRow } from './types';

/**
 * The Event's referee table: a "Protests" column after the cards. A zero reads as a dash, as the
 * cards column does, so an empty cell never looks like a counted nothing in one column and a
 * dash in the next.
 */

const t = (key: string) => key;

const row = (personId: string, protests: number): RefereeWorkloadRow => ({
  personId,
  name: personId,
  matchesReffed: 2,
  roles: { arbitre_declarant: 2, arbitre_assesseur: 0, arbitre_table: 0 },
  cards: { yellow: 0, red: 0, black: 0 },
  protests,
  averageRefereeTimeMs: 60_000,
});

/** The text of every cell of the one body row, in column order. */
function cells(referee: RefereeWorkloadRow): string[] {
  const html = renderToStaticMarkup(<RefereeWorkloadTable referees={[referee]} t={t} />);
  const body = html.slice(html.indexOf('<tbody>'));
  return [...body.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((match) =>
    (match[1] ?? '').replace(/<[^>]+>/g, ''),
  );
}

describe('RefereeWorkloadTable protests column', () => {
  it('heads a Protests column right after the cards', () => {
    const html = renderToStaticMarkup(<RefereeWorkloadTable referees={[row('a', 1)]} t={t} />);
    const heads = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((match) => match[1]);
    const cards = heads.indexOf('organizer.eventStats.referees.colCards');
    expect(heads[cards + 1]).toBe('organizer.eventStats.referees.colProtests');
  });

  it('shows the count the referee faced', () => {
    expect(cells(row('a', 3))[6]).toBe('3');
  });

  it('shows a dash at zero, as the cards column does', () => {
    const zero = cells(row('a', 0));
    expect(zero[5]).toBe('—');
    expect(zero[6]).toBe('—');
  });
});
