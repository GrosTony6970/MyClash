import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { notTakenBack } from './useTakenBack';

/**
 * The screen's lists leave out an entry the referee took back.
 *
 * He undid hit 5 with no connection. The wifi is back and the bout is read
 * again before the pad settled hit 5: the server still holds it, so it was the
 * last line of the list again. His next Undo takes back hit 4 (the undo leaves
 * hit 5 out), so he saw one entry go and lost two.
 */
const row = (id: string, client_uuid?: string | null) => ({ id, client_uuid });

describe('notTakenBack', () => {
  const rows = [row('ex-4', 'uuid-4'), row('ex-5', 'uuid-5'), row('ex-old', null), row('ex-bare')];

  it('leaves out the rows written down, and keeps the order of the others', () => {
    expect(notTakenBack(rows, new Set(['uuid-5'])).map((kept) => kept.id)).toEqual([
      'ex-4',
      'ex-old',
      'ex-bare',
    ]);
  });

  it('keeps every row while nothing is written down', () => {
    expect(notTakenBack(rows, new Set())).toEqual(rows);
  });

  it('keeps a row the tablet gave no id, whatever is written down', () => {
    expect(notTakenBack([row('ex-old', null)], new Set(['null', '']))).toHaveLength(1);
  });
});

describe('the bout’s lists', () => {
  const hook = readFileSync(join(__dirname, 'useMatchScoringData.ts'), 'utf8');

  it('are the server’s rows less the ones taken back, hits and cards', () => {
    expect(hook).toContain('const takenBack = useTakenBack(refreshKey, args.syncPendingCount);');
    expect(hook).toContain('const activeExchanges = notTakenBack(serverExchanges, takenBack);');
    expect(hook).toContain('const activePenalties = notTakenBack(serverPenalties, takenBack);');
    expect(hook).toMatch(/active: serverExchanges, refresh: refreshExchanges \} = useExchanges\(/);
    expect(hook).toMatch(/active: serverPenalties,\s+resolveCard,\s+\} = usePenalties\(/);
  });
});
