import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offlineResponse } from '../offline/failure-kind';
import { json } from './piste-read.fixtures';
import { serverNextSequence } from './sequence-seed';

/**
 * Tablet A records hits 1 to 10, a card at 9 is among them, then protest 11,
 * and dies. Tablet B opens the bout: its next entry must take 12. Seeded from
 * the hits alone it took 11, met UNIQUE(match_id, sequence) on the protests,
 * and the protest landed in B's held inbox.
 */
const rows = (...sequences: number[]) => sequences.map((sequence) => ({ sequence }));

function serverHolding(lists: Record<string, unknown>) {
  vi.stubGlobal('fetch', (url: string) => {
    const list = Object.keys(lists).find((name) => url.endsWith(`/api/v1/matches/bout-1/${name}`));
    return Promise.resolve(list ? json(lists[list]) : json({}, 404));
  });
}

const seed = () => serverNextSequence('', 'bout-1', new AbortController().signal);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('serverNextSequence: the bout’s next sequence as the server holds it', () => {
  it('a protest is the newest entry: the next one is after it', async () => {
    serverHolding({
      exchanges: rows(1, 2, 3, 4, 5, 6, 7, 8, 10),
      penalties: rows(9),
      protests: rows(11),
    });
    expect(await seed()).toBe(12);
  });

  it('a card is the newest entry: the next one is after it', async () => {
    serverHolding({ exchanges: rows(1, 2, 3), penalties: rows(4), protests: [] });
    expect(await seed()).toBe(5);
  });

  it('a voided row keeps its number', async () => {
    serverHolding({
      exchanges: [{ sequence: 1 }, { sequence: 2, voided: true }],
      penalties: [],
      protests: [],
    });
    expect(await seed()).toBe(3);
  });

  it('a list that does not answer adds nothing; the others still count', async () => {
    serverHolding({ exchanges: rows(1, 2), protests: rows(3) });
    expect(await seed()).toBe(4);
  });

  it('says nothing with no network: the tablet’s own seed is the answer', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(offlineResponse()));
    expect(await seed()).toBeNull();
  });

  it('a bout with no entry starts at 1', async () => {
    serverHolding({ exchanges: [], penalties: [], protests: [] });
    expect(await seed()).toBe(1);
  });

  it('is the bout screen’s server seed, beside the tablet’s own', () => {
    const view = readFileSync(join(__dirname, '..', 'components', 'MatchView.tsx'), 'utf8');
    expect(view).toContain(
      'const server = await serverNextSequence(apiUrl, match.id, controller.signal);',
    );
    expect(view).toContain('if (server !== null) seeds.push(server);');
  });
});
