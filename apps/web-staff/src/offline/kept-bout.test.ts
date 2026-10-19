import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { forgetBout, keepBout, keepList, keptBout, keptList } from './kept-bout';
import type { MatchInfo } from '../components/MatchView';

const BOUT: MatchInfo = {
  id: 'bout-1',
  matchNumberLabel: 'M3',
  status: 'running',
  rulesetCode: 'TF',
  rulesetVersion: '1.0.0',
  redRegistrationId: 'red-1',
  blueRegistrationId: 'blue-1',
  redScore: 3,
  blueScore: 2,
  redFighterName: 'Ana Red',
  blueFighterName: 'Bo Blue',
};

beforeEach(async () => {
  await db.reads.clear();
  vi.useRealTimers();
});

describe('the copy of a bout the tablet keeps', () => {
  it('is nothing for a bout the tablet never read', async () => {
    expect(await keptBout('bout-1')).toBeNull();
  });

  it('is the bout as it was read, with the time of that read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T14:32:00Z'));

    await keepBout(BOUT, Date.now(), undefined);

    expect(await keptBout('bout-1')).toEqual({
      match: BOUT,
      readAt: new Date('2026-10-10T14:32:00Z').getTime(),
    });
  });

  it('is the newest read of that bout', async () => {
    await keepBout(BOUT, Date.now(), undefined);
    await keepBout({ ...BOUT, redScore: 5 }, Date.now(), undefined);

    expect((await keptBout('bout-1'))?.match.redScore).toBe(5);
  });

  // A later answer without the bout's rules (a passing fault of the server) keeps the copy's.
  it('keeps the rules it holds when a newer read carries none', async () => {
    const rules = { cardRulesetId: 'cards-a' } as MatchInfo['rules'];
    await keepBout({ ...BOUT, rules }, Date.now(), undefined);
    await keepBout({ ...BOUT, redScore: 5 }, Date.now(), undefined);

    expect((await keptBout('bout-1'))?.match).toMatchObject({ redScore: 5, rules });
  });

  // The reconnect race, for the copy a reload with no network opens: the bout started on copy A,
  // the server still has it `scheduled` on the stamped copy B, and its Start waits.
  it('keeps the rules a bout started under while its Start waits, with their edition and pair', async () => {
    const onA = {
      ...BOUT,
      rules: { id: 'copy-a', cardRulesetId: 'cards-a' },
      decisionEdition: '2026-04',
    } as MatchInfo;
    const onB = {
      ...BOUT,
      status: 'scheduled',
      rulesetCode: 'Generic_PointsCap',
      rulesetVersion: '1.1.0',
      rules: { id: 'copy-b', cardRulesetId: 'cards-b' },
      decisionEdition: '2026-10',
    } as MatchInfo;
    await keepBout(onA, Date.now(), undefined);

    await keepBout(onB, Date.now(), 'copy-a');
    expect((await keptBout('bout-1'))?.match).toMatchObject({
      status: 'scheduled',
      rules: onA.rules,
      decisionEdition: '2026-04',
      rulesetCode: 'TF',
    });

    await keepBout(onB, Date.now(), undefined);
    expect((await keptBout('bout-1'))?.match.rules).toEqual(onB.rules);
  });

  it('is kept per bout', async () => {
    await keepBout(BOUT, Date.now(), undefined);
    await keepBout({ ...BOUT, id: 'bout-2', redFighterName: 'Cy Next' }, Date.now(), undefined);

    expect((await keptBout('bout-1'))?.match.redFighterName).toBe('Ana Red');
    expect((await keptBout('bout-2'))?.match.redFighterName).toBe('Cy Next');
  });

  it('is forgotten when the server says the bout is gone', async () => {
    await keepBout(BOUT, Date.now(), undefined);
    await keepBout({ ...BOUT, id: 'bout-2' }, Date.now(), undefined);

    await forgetBout('bout-1');

    expect(await keptBout('bout-1')).toBeNull();
    expect(await keptBout('bout-2')).not.toBeNull();
  });

  it('keeps the hits and the cards of a bout, each under its own name', async () => {
    await keepList('bout-1', 'exchanges', [{ id: 'hit-1' }]);
    await keepList('bout-1', 'penalties', [{ id: 'card-1' }]);

    expect(await keptList('bout-1', 'exchanges')).toEqual([{ id: 'hit-1' }]);
    expect(await keptList('bout-1', 'penalties')).toEqual([{ id: 'card-1' }]);
    expect(await keptList('bout-2', 'exchanges')).toBeNull();
  });

  it('forgets the hits and the cards with the bout', async () => {
    await keepBout(BOUT, Date.now(), undefined);
    await keepList('bout-1', 'exchanges', [{ id: 'hit-1' }]);
    await keepList('bout-1', 'penalties', [{ id: 'card-1' }]);
    await keepList('bout-2', 'exchanges', [{ id: 'hit-2' }]);

    await forgetBout('bout-1');

    expect(await keptList('bout-1', 'exchanges')).toBeNull();
    expect(await keptList('bout-1', 'penalties')).toBeNull();
    expect(await keptList('bout-2', 'exchanges')).toEqual([{ id: 'hit-2' }]);
  });

  it('shares its table with the rules the tablet keeps, and touches none of them', async () => {
    await db.reads.put({ path: '/api/v1/tournaments/t-1/match-config', body: {}, fetchedAt: 1 });

    await keepBout(BOUT, Date.now(), undefined);
    await forgetBout('bout-1');

    expect(await db.reads.count()).toBe(1);
  });
});
