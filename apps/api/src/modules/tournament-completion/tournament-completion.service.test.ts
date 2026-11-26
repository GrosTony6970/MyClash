import { describe, expect, it, vi } from 'vitest';
import { TournamentCompletionService } from './tournament-completion.service';

/**
 * Ruling 892: a Tournament completes by itself — (1) once its bracket has a champion, (2) when its
 * Event completes — and runs again when a bout of it reopens while its Event is live. Nothing
 * completed one before, so fighters never got "results published".
 *
 * Every query is recorded (table, select string, each filter with its arguments) and answered by
 * the test, because a double that answers whatever was asked lets a dropped filter pass.
 */

interface Query {
  table: string;
  select?: string;
  head?: boolean;
  update?: Record<string, unknown>;
  filters: Array<[string, ...unknown[]]>;
}
type Answer = { data?: unknown; count?: number | null; error?: null };

function harness(answer: (q: Query) => Answer) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const q: Query = { table, filters: [] };
    queries.push(q);
    const settle = () => ({ error: null, data: null, ...answer(q) });
    const filter =
      (name: string) =>
      (...args: unknown[]) => (q.filters.push([name, ...args]), chain);
    const chain: Record<string, unknown> = {
      select: vi.fn((columns: string, options?: { head?: boolean }) => {
        q.select = columns;
        q.head = options?.head;
        return chain;
      }),
      update: vi.fn((row: Record<string, unknown>) => ((q.update = row), chain)),
      eq: filter('eq'),
      in: filter('in'),
      not: filter('not'),
      is: filter('is'),
      maybeSingle: vi.fn(async () => settle()),
      then: (resolve: (value: unknown) => unknown) => resolve(settle()),
    };
    return chain;
  });
  const resultsPublished = vi.fn().mockResolvedValue(undefined);
  const service = new TournamentCompletionService(
    { service: { from } } as never,
    { resultsPublished } as never,
  );
  const writes = () => queries.filter((q) => q.update);
  return { service, queries, writes, resultsPublished };
}

const has = (q: Query, ...filter: [string, ...unknown[]]) =>
  q.filters.some((f) => JSON.stringify(f) === JSON.stringify(filter));

/** The world of one Tournament: its status, phases, bouts left, winnerless bracket bouts. */
function world(o: {
  status: string;
  phases?: Array<{ id: string; type: string; config_json?: unknown }>;
  unfinished?: number;
  winnerless?: number;
  eventStatus?: string;
  slots?: unknown[];
  bouts?: unknown[];
  moved?: boolean;
}) {
  return (q: Query): Answer => {
    if (q.update) return { data: o.moved === false ? [] : [{ id: 't-1' }] };
    if (q.table === 'tournaments' && q.select?.includes('events!inner')) {
      return { data: { id: 't-1', events: { status: o.eventStatus ?? 'running' } } };
    }
    if (q.table === 'tournaments') return { data: { id: 't-1', status: o.status } };
    if (q.table === 'phases') return { data: o.phases ?? [{ id: 'ph', type: 'single_elim' }] };
    if (q.table === 'bracket_slots') return { data: o.slots ?? [] };
    if (q.table === 'matches' && q.head && has(q, 'is', 'winner_registration_id', null)) {
      return { count: o.winnerless ?? 0 };
    }
    if (q.table === 'matches' && q.head) return { count: o.unfinished ?? 0 };
    if (q.table === 'matches') return { data: o.bouts ?? [] };
    throw new Error(`unexpected query on ${q.table}`);
  };
}

describe('settleAfterBout: rule 1, a bracket with a champion completes', () => {
  it('completes a running Tournament and publishes its results, from the status it read', async () => {
    const { service, writes, resultsPublished } = harness(world({ status: 'running' }));

    await service.settleAfterBout('t-1');

    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.update).toMatchObject({ status: 'completed' });
    expect(writes()[0]!.filters).toEqual([
      ['eq', 'id', 't-1'],
      ['eq', 'status', 'running'],
    ]);
    expect(resultsPublished).toHaveBeenCalledWith('t-1');
  });

  it('asks the right questions: bracket phases, bouts left, winnerless bracket bouts', async () => {
    const { service, queries } = harness(world({ status: 'running' }));

    await service.settleAfterBout('t-1');

    const phases = queries.find((q) => q.table === 'phases')!;
    expect(phases.filters).toContainEqual(['in', 'type', ['single_elim', 'double_elim']]);
    expect(phases.filters).toContainEqual(['eq', 'tournament_id', 't-1']);
    const [left, winnerless] = queries.filter((q) => q.table === 'matches' && q.head);
    // Scoped to THIS Tournament through the phase, and neither completed nor voided.
    expect(left!.select).toBe('id, phases!inner(tournament_id)');
    expect(left!.filters).toEqual([
      ['eq', 'phases.tournament_id', 't-1'],
      ['not', 'status', 'in', '("completed","voided")'],
    ]);
    expect(winnerless!.select).toBe('id, phases!inner(tournament_id, type)');
    expect(winnerless!.filters).toEqual([
      ['eq', 'phases.tournament_id', 't-1'],
      ['in', 'phases.type', ['single_elim', 'double_elim']],
      ['eq', 'status', 'completed'],
      // A team bracket's winner is in `winner_team_id` (0282): a bout with either is decided.
      ['is', 'winner_registration_id', null],
      ['is', 'winner_team_id', null],
    ]);
  });

  it('waits while a bout is left (a bronze bout, a reset made)', async () => {
    const { service, writes } = harness(world({ status: 'running', unfinished: 1 }));
    await service.settleAfterBout('t-1');
    expect(writes()).toHaveLength(0);
  });

  it('waits when a bracket bout ended with no winner: no champion yet', async () => {
    const { service, writes } = harness(world({ status: 'running', winnerless: 1 }));
    await service.settleAfterBout('t-1');
    expect(writes()).toHaveLength(0);
  });

  it('leaves a Tournament with no bracket: its pools ending proves nothing', async () => {
    const { service, writes } = harness(world({ status: 'running', phases: [] }));
    await service.settleAfterBout('t-1');
    expect(writes()).toHaveLength(0);
  });

  it('leaves a draft: completing it would show it', async () => {
    const { service, writes } = harness(world({ status: 'draft' }));
    await service.settleAfterBout('t-1');
    expect(writes()).toHaveLength(0);
  });

  it('waits on a grand final the losers’ side won while its reset is not made yet', async () => {
    const config = { grandFinalReset: true, wbRounds: 2, lbRounds: 2 };
    const slots = [
      { id: 'gf', round: 5, registration_a_id: 'wb-champ' },
      { id: 'reset', round: 6, registration_a_id: null },
    ];
    const lbWon = [{ bracket_slot_id: 'gf', winner_registration_id: 'lb-champ' }];
    const phases = [{ id: 'de', type: 'double_elim', config_json: config }];

    const owed = harness(world({ status: 'running', phases, slots, bouts: lbWon }));
    await owed.service.settleAfterBout('t-1');
    expect(owed.writes()).toHaveLength(0);

    // The winners' side won it: no reset, the bracket is over.
    const wbWon = [{ bracket_slot_id: 'gf', winner_registration_id: 'wb-champ' }];
    const over = harness(world({ status: 'running', phases, slots, bouts: wbWon }));
    await over.service.settleAfterBout('t-1');
    expect(over.writes()).toHaveLength(1);
  });

  it('sends nothing when the status moved meanwhile (the other last bout, an organiser)', async () => {
    const { service, resultsPublished } = harness(world({ status: 'running', moved: false }));
    await service.settleAfterBout('t-1');
    expect(resultsPublished).not.toHaveBeenCalled();
  });

  it('puts the status back when the notice fails, so the next ask announces again', async () => {
    const { service, writes, resultsPublished } = harness(world({ status: 'running' }));
    resultsPublished.mockRejectedValueOnce(new Error('queue down'));

    await expect(service.settleAfterBout('t-1')).rejects.toThrow('queue down');

    expect(writes().map((w) => [w.update!['status'], w.filters[1]])).toEqual([
      ['completed', ['eq', 'status', 'running']],
      ['running', ['eq', 'status', 'completed']],
    ]);
  });

  it('runs a completed Tournament again when a correction gave it a bout to fight', async () => {
    const { service, writes } = harness(world({ status: 'completed', unfinished: 1 }));
    await service.settleAfterBout('t-1');
    expect(writes().map((w) => w.update!['status'])).toEqual(['running']);
    expect(writes()[0]!.filters).toContainEqual(['eq', 'status', 'completed']);
  });
});

describe('reopenForBoutUndone', () => {
  it('runs a completed Tournament again while its Event is live', async () => {
    const { service, queries, writes } = harness(world({ status: 'completed' }));
    await service.reopenForBoutUndone('t-1');
    expect(writes().map((w) => w.update!['status'])).toEqual(['running']);
    expect(queries.some((q) => q.select === 'id, events!inner(status)')).toBe(true);
  });

  it('leaves it completed once its Event is over', async () => {
    for (const eventStatus of ['completed', 'archived']) {
      const { service, writes } = harness(world({ status: 'completed', eventStatus }));
      await service.reopenForBoutUndone('t-1');
      expect(writes()).toHaveLength(0);
    }
  });
});

describe('completeOpenTournaments: rule 2, the Event completes', () => {
  const open = (q: Query): Answer => {
    if (q.update) return { data: [{ id: 'x' }] };
    return {
      data: [
        { id: 't-pools', status: 'running' },
        { id: 't-swiss', status: 'published' },
      ],
    };
  };

  it('completes every open Tournament of the Event and announces each', async () => {
    const { service, queries, writes, resultsPublished } = harness(open);

    expect(await service.completeOpenTournaments('ev-1')).toEqual(['t-pools', 't-swiss']);

    expect(queries[0]!.filters).toEqual([
      ['eq', 'event_id', 'ev-1'],
      ['in', 'status', ['published', 'running']],
    ]);
    expect(writes().map((w) => w.filters)).toEqual([
      [
        ['eq', 'id', 't-pools'],
        ['eq', 'status', 'running'],
      ],
      [
        ['eq', 'id', 't-swiss'],
        ['eq', 'status', 'published'],
      ],
    ]);
    expect(resultsPublished.mock.calls).toEqual([['t-pools'], ['t-swiss']]);
  });

  it('tells nobody when the Event went straight from draft: old news (ruling 190)', async () => {
    const { service, writes, resultsPublished } = harness(open);
    await service.completeOpenTournaments('ev-1', { announce: false });
    expect(writes()).toHaveLength(2);
    expect(resultsPublished).not.toHaveBeenCalled();
  });
});

describe('reopenUnfinishedOfEvent: an Event put back from completed', () => {
  it('runs again each completed Tournament with a bout left, and only those', async () => {
    const { service, writes } = harness((q) => {
      if (q.update) return { data: [{ id: 'x' }] };
      if (q.table === 'tournaments' && q.select?.includes('events!inner')) {
        return { data: { events: { status: 'running' } } };
      }
      if (q.table === 'tournaments') {
        return {
          data: [
            { id: 't-done', status: 'completed' },
            { id: 't-cut', status: 'completed' },
          ],
        };
      }
      // t-done has every bout fought; t-cut was completed mid-pools.
      return { count: has(q, 'eq', 'phases.tournament_id', 't-cut') ? 6 : 0 };
    });

    await service.reopenUnfinishedOfEvent('ev-1');

    expect(writes().map((w) => w.filters[0])).toEqual([['eq', 'id', 't-cut']]);
  });
});
