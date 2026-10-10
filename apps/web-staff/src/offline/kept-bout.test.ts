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

    await keepBout(BOUT);

    expect(await keptBout('bout-1')).toEqual({
      match: BOUT,
      readAt: new Date('2026-10-10T14:32:00Z').getTime(),
    });
  });

  it('is the newest read of that bout', async () => {
    await keepBout(BOUT);
    await keepBout({ ...BOUT, redScore: 5 });

    expect((await keptBout('bout-1'))?.match.redScore).toBe(5);
  });

  it('is kept per bout', async () => {
    await keepBout(BOUT);
    await keepBout({ ...BOUT, id: 'bout-2', redFighterName: 'Cy Next' });

    expect((await keptBout('bout-1'))?.match.redFighterName).toBe('Ana Red');
    expect((await keptBout('bout-2'))?.match.redFighterName).toBe('Cy Next');
  });

  it('is forgotten when the server says the bout is gone', async () => {
    await keepBout(BOUT);
    await keepBout({ ...BOUT, id: 'bout-2' });

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
    await keepBout(BOUT);
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

    await keepBout(BOUT);
    await forgetBout('bout-1');

    expect(await db.reads.count()).toBe(1);
  });
});
