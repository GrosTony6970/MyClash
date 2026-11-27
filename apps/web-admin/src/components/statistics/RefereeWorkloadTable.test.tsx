import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { RefereeWorkloadTable } from './RefereeWorkloadTable';
import type { RefereeWorkloadRow } from './types';

/**
 * The Event's referee table: a "Protests" column after the cards. A zero reads as a dash, as the
 * cards column does, so an empty cell never looks like a counted nothing in one column and a
 * dash in the next. Then an average time per role, every column sortable, and a name search.
 */

const t = (key: string) => key;

const row = (
  personId: string,
  protests: number,
  over: Partial<RefereeWorkloadRow> = {},
): RefereeWorkloadRow => ({
  personId,
  name: personId,
  matchesReffed: 2,
  roles: { arbitre_declarant: 2, arbitre_assesseur: 0, arbitre_table: 0 },
  cards: { yellow: 0, red: 0, black: 0 },
  protests,
  averageRefereeTimeMs: 60_000,
  averageTimeMsByRole: { arbitre_declarant: 60_000, arbitre_assesseur: 0, arbitre_table: 0 },
  ...over,
});

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');

/** The text of every header, in column order. */
function heads(html: string): string[] {
  return [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((match) => stripTags(match[1] ?? ''));
}

/** The text of every cell of the one body row, in column order. */
function cells(referee: RefereeWorkloadRow): string[] {
  const html = renderToStaticMarkup(<RefereeWorkloadTable referees={[referee]} t={t} />);
  const body = html.slice(html.indexOf('<tbody>'));
  return [...body.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((match) => stripTags(match[1] ?? ''));
}

describe('RefereeWorkloadTable protests column', () => {
  it('heads a Protests column right after the cards', () => {
    const all = heads(
      renderToStaticMarkup(<RefereeWorkloadTable referees={[row('a', 1)]} t={t} />),
    );
    const cards = all.indexOf('organizer.eventStats.referees.colCards');
    expect(all[cards + 1]).toBe('organizer.eventStats.referees.colProtests');
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

describe('RefereeWorkloadTable average time per role', () => {
  it('heads lead, assessor and table times right after the overall time', () => {
    const all = heads(
      renderToStaticMarkup(<RefereeWorkloadTable referees={[row('a', 0)]} t={t} />),
    );
    const avg = all.indexOf('organizer.eventStats.referees.colAvgTime');
    expect(all.slice(avg + 1)).toEqual([
      'organizer.eventStats.referees.colAvgLead',
      'organizer.eventStats.referees.colAvgAssessor',
      'organizer.eventStats.referees.colAvgTable',
    ]);
  });

  it('shows each role time as m:ss, and a dash for a role never held', () => {
    const r = row('a', 0, {
      averageTimeMsByRole: {
        arbitre_declarant: 454_000,
        arbitre_assesseur: 0,
        arbitre_table: 65_000,
      },
    });
    expect(cells(r).slice(8)).toEqual(['7:34', '—', '1:05']);
  });
});

// ── Interaction: sort + search ────────────────────────────────────────────────

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function mount(referees: RefereeWorkloadRow[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<RefereeWorkloadTable referees={referees} t={t} />);
  });
}

/** The first cell of every body row: the names, in display order. */
const names = () =>
  [...document.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent);

async function clickHead(labelKey: string) {
  const button = [...document.querySelectorAll('th button')].find(
    (b) => b.querySelector('span')?.textContent === `organizer.eventStats.referees.${labelKey}`,
  ) as HTMLButtonElement;
  await act(async () => button.click());
}

async function type(value: string) {
  const input = document.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const ROWS = [
  row('Denis Allaume', 0, { matchesReffed: 5 }),
  row('Anthony Garnier', 0, {
    matchesReffed: 3,
    cards: { yellow: 1, red: 1, black: 0 },
    averageTimeMsByRole: { arbitre_declarant: 0, arbitre_assesseur: 0, arbitre_table: 0 },
  }),
  row('Egon Beyrens', 0, {
    matchesReffed: 4,
    cards: { yellow: 5, red: 2, black: 0 },
    averageTimeMsByRole: { arbitre_declarant: 454_000, arbitre_assesseur: 0, arbitre_table: 0 },
  }),
  row('François Berdou', 0, { matchesReffed: 1 }),
];

describe('RefereeWorkloadTable sorting', () => {
  it('opens a number column biggest first, then flips, then returns to the API order', async () => {
    await mount(ROWS);
    const apiOrder = names();
    await clickHead('colMatches');
    expect(names()).toEqual([
      'Denis Allaume',
      'Egon Beyrens',
      'Anthony Garnier',
      'François Berdou',
    ]);
    await clickHead('colMatches');
    expect(names()).toEqual([
      'François Berdou',
      'Anthony Garnier',
      'Egon Beyrens',
      'Denis Allaume',
    ]);
    await clickHead('colMatches');
    expect(names()).toEqual(apiOrder);
  });

  it('opens the name column A→Z', async () => {
    await mount(ROWS);
    await clickHead('colReferee');
    expect(names()).toEqual([
      'Anthony Garnier',
      'Denis Allaume',
      'Egon Beyrens',
      'François Berdou',
    ]);
  });

  it('sorts the cards on their total', async () => {
    await mount(ROWS);
    await clickHead('colCards');
    expect(names().slice(0, 2)).toEqual(['Egon Beyrens', 'Anthony Garnier']);
  });

  it('keeps a role time never held last in both directions', async () => {
    await mount(ROWS);
    await clickHead('colAvgLead');
    expect(names().at(-1)).toBe('Anthony Garnier');
    expect(names()[0]).toBe('Egon Beyrens');
    await clickHead('colAvgLead');
    expect(names().at(-1)).toBe('Anthony Garnier');
    expect(names().at(-2)).toBe('Egon Beyrens');
  });
});

describe('RefereeWorkloadTable name search', () => {
  it('finds a name without its accents', async () => {
    await mount(ROWS);
    await type('francois');
    expect(names()).toEqual(['François Berdou']);
  });

  it('says so when nobody matches, and Clear brings every row back', async () => {
    await mount(ROWS);
    await type('zzz');
    expect(document.querySelector('tbody')?.textContent).toBe(
      'organizer.eventStats.referees.noMatch',
    );
    const clear = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'actions.clear',
    ) as HTMLButtonElement;
    await act(async () => clear.click());
    expect(names()).toHaveLength(ROWS.length);
  });
});
