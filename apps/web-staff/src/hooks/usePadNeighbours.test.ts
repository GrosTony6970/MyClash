import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { neighboursOnPad } from './usePadNeighbours';

const tile = (id: string) => ({
  id,
  matchNumberLabel: null,
  roundCode: null,
  redName: 'Ana Red',
  blueName: 'Bo Blue',
});
const NOTHING = { previous: null, next: null };

describe('whose neighbours the tiles show', () => {
  const tablet = { matchId: 'bout-2', previous: tile('bout-1'), next: tile('bout-3') };

  it('the tablet’s own, while the server has said nothing for this bout', () => {
    const silent = { ...NOTHING, answered: false };

    expect(neighboursOnPad(silent, tablet, 'bout-2')).toEqual({
      previous: tile('bout-1'),
      next: tile('bout-3'),
    });
  });

  it('the server’s, once it has answered, whatever the tablet holds', () => {
    const server = { previous: tile('bout-1'), next: tile('bout-2b'), answered: true };

    expect(neighboursOnPad(server, tablet, 'bout-2')).toEqual({
      previous: tile('bout-1'),
      next: tile('bout-2b'),
    });
  });

  // The last bout of the piste on the server; the tablet's order is older and
  // still has a bout after it.
  it('none, when the server answered that this bout has no neighbour', () => {
    expect(neighboursOnPad({ ...NOTHING, answered: true }, tablet, 'bout-2')).toEqual(NOTHING);
  });

  // The store answers late: the screen is on bout 3 when the neighbours of
  // bout 2 land. Their Next IS bout 3.
  it('none, from what the tablet held for another bout', () => {
    expect(neighboursOnPad({ ...NOTHING, answered: false }, tablet, 'bout-3')).toEqual(NOTHING);
    expect(neighboursOnPad({ ...NOTHING, answered: false }, null, 'bout-2')).toEqual(NOTHING);
  });
});

/** The pad has no React test setup: the hook's wiring is pinned as text. */
describe('usePadNeighbours', () => {
  const hook = readFileSync(join(__dirname, 'usePadNeighbours.ts'), 'utf8');

  it('holds what the tablet gave with the bout it gave it for', () => {
    expect(hook).toContain('if (!cancelled && kept) setTablet({ matchId, ...kept });');
    expect(hook).toContain('return neighboursOnPad(server, tablet, matchId);');
  });

  it('reads the tablet again when the bout, its piste or the screen’s read moves', () => {
    expect(hook).toContain('}, [liceId, matchId, refreshKey]);');
    expect(hook).toContain('const server = useAdjacentMatches(apiUrl, match.id, refreshKey);');
  });

  it('is what the bout screen reads its tiles and its "Next match" from', () => {
    const view = readFileSync(join(__dirname, '..', 'components', 'MatchView.tsx'), 'utf8');
    expect(view).toContain('= usePadNeighbours(apiUrl, match, refreshKey);');
  });
});
