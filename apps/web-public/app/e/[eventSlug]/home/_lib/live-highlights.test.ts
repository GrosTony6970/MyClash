import { describe, expect, it } from 'vitest';
import type { LiveMatch, LiveState } from '../../live/use-live-board';
import { highlightsOf } from './live-highlights';

const bout = (id: string, status: string): LiveMatch => ({
  id,
  matchNumberLabel: `L1-P1-${id}`,
  redFighterName: 'Ada Lovelace',
  blueFighterName: 'Mary Somerville',
  scheduledAt: '2027-06-12T08:30:00.000Z',
  status,
  tournamentName: 'Longsword Open',
  redScore: 5,
  blueScore: 3,
});

const piste = (name: string, running: LiveMatch | null, next: LiveMatch | null) => ({
  lice: { id: `id-${name}`, name, sortOrder: 1 },
  runningMatch: running,
  nextMatch: next,
});

describe('highlightsOf', () => {
  it("gives each piste's bout in play, then its next bout, named with the piste", () => {
    const state: LiveState = {
      currentBlock: null,
      nextBlock: null,
      lices: [
        piste('Piste 1', bout('M01', 'running'), bout('M02', 'scheduled')),
        piste('Piste 2', null, bout('M07', 'scheduled')),
      ],
    };
    expect(highlightsOf(state).map((m) => [m.id, m.liceName])).toEqual([
      ['M01', 'Piste 1'],
      ['M02', 'Piste 1'],
      ['M07', 'Piste 2'],
    ]);
    expect(highlightsOf(state)[0]).toMatchObject({ redScore: 5, status: 'running' });
  });

  it('gives nothing before any picture: the server read failed', () => {
    expect(highlightsOf(null)).toEqual([]);
  });
});
