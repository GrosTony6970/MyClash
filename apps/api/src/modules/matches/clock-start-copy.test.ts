import type { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMigrationSchema } from '../../common/testing/migration-schema';
import {
  filtersFor,
  queriedTables,
  selectsFor,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { columnsFromSelect } from '../../common/testing/supabase-select-parse';
import { BOUT_COLUMNS } from './clock.service';
import {
  BOUT,
  IDLE,
  NOW,
  PRESS,
  RUNNING,
  at,
  collide,
  press,
  row,
  setup,
} from './clock-late-press.fixtures';
import type { LatePress } from './late-press';

/**
 * A Start from a tablet's queue keeps the copy of the rules its screen showed, when it was
 * pressed with no network (ruling "Offline rules", 2026-10-16, and the rulings of 2026-10-17).
 *
 * The wifi in the hall is down. On piste 2 the tablet starts a bout under copy A (TF_v1, cap 5).
 * At the desk the organiser switches the Tournament: the bout, still `scheduled` on the server,
 * moves to copy B. When the wifi is back the Start arrives naming A, with the tablet's evidence
 * that it was pressed with no network, and the bout is played under A.
 */
const COPY_A = 'c0000000-0000-4000-8000-00000000000a';
const COPY_B = 'c0000000-0000-4000-8000-00000000000b';
const COPY_C = 'c0000000-0000-4000-8000-00000000000c';
const NEVER = 'c0000000-0000-4000-8000-0000000000ff';

/** The copies of the bout's Tournament, as `match_rules` holds them. */
const COPIES: SupabaseRow[] = [
  { id: COPY_A, ruleset_code: 'TF_v1', ruleset_version: '1.0.0', ruleset_content_hash: 'hash-a' },
  {
    id: COPY_B,
    ruleset_code: 'Generic_PointsCap',
    ruleset_version: '1.1.0',
    ruleset_content_hash: 'hash-b',
  },
  { id: COPY_C, ruleset_code: 'TF_v1', ruleset_version: '1.1.0', ruleset_content_hash: null },
];

/** A bout not started, which a change of the rules moved from A to B. */
const MOVED: SupabaseRow = {
  status: 'scheduled',
  started_at: null,
  match_rules_id: COPY_B,
  earlier_rules_ids: [COPY_A],
};

function start(moreBout: SupabaseRow = MOVED, copies: SupabaseRow[] = COPIES, events = IDLE) {
  const built = setup(events, moreBout);
  const real = built.db.service.from;
  // `setup` seeds no `match_rules`: the copies are answered beside its tables.
  built.db.service.from = vi.fn((table: string) =>
    table === 'match_rules' ? copiesTable(copies) : real(table),
  ) as never;
  const warn = vi.spyOn((built.clock as unknown as { logger: Logger }).logger, 'warn');
  return { ...built, warn };
}

/** A `match_rules` read: the row with the asked id, or what `copies` says. */
function copiesTable(copies: SupabaseRow[] | { error: { message: string } }) {
  let asked: unknown;
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((_column: string, value: unknown) => {
      asked = value;
      return chain;
    }),
    maybeSingle: vi.fn(async () =>
      Array.isArray(copies)
        ? { data: copies.find((copy) => copy['id'] === asked) ?? null, error: null }
        : { data: null, error: copies.error },
    ),
  };
  return chain;
}

const offline = (rulesId: string, clock = '10:00:00'): LatePress => ({
  ...press(clock),
  startedUnder: { rulesId },
  pressedWithoutNetwork: true,
});

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a Start pressed with no network keeps the copy its tablet showed', () => {
  it('puts a bout the stamp moved to B back on A, with A’s engine, in the write that starts it', async () => {
    const { db, clock, warn } = start();

    await clock.latePress(BOUT, 'start', offline(COPY_A));

    expect(writesTo(db, 'matches').map((write) => write.row)).toEqual([
      {
        status: 'running',
        started_at: at('10:00:00'),
        match_rules_id: COPY_A,
        ruleset_code: 'TF_v1',
        ruleset_version: '1.0.0',
        ruleset_content_hash: 'hash-a',
      },
    ]);
    expect(warn).toHaveBeenCalledWith(`Bout ${BOUT}: kept the pad's copy ${COPY_A}`);
  });

  // The stamp may land between the door's read and its write: comparing first and skipping the
  // write when the read shows the pad's copy would leave the bout on B.
  it('writes the copy even when the door read it as the current one', async () => {
    const { db, clock, warn } = start({ ...MOVED, match_rules_id: COPY_A, earlier_rules_ids: [] });

    await clock.latePress(BOUT, 'start', offline(COPY_A));

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      match_rules_id: COPY_A,
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
    });
    // Nothing kept that the bout did not already hold: no trace.
    expect(warn).not.toHaveBeenCalled();
  });

  it('two changes of the rules, then a Start naming the first copy: the first copy', async () => {
    const { db, clock } = start({
      ...MOVED,
      match_rules_id: COPY_C,
      earlier_rules_ids: [COPY_A, COPY_B],
    });

    await clock.latePress(BOUT, 'start', offline(COPY_A));

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ match_rules_id: COPY_A });
  });

  it('reads the copy it names, and nothing else', async () => {
    const { db, clock } = start();
    const asked: unknown[][] = [];
    const real = db.service.from;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      if (table === 'match_rules') {
        const select = chain.select;
        chain.select = vi.fn((columns: string) => {
          asked.push(['select', columns]);
          return select(columns);
        }) as never;
        const eq = chain.eq;
        chain.eq = vi.fn((column: string, value: unknown) => {
          asked.push(['eq', column, value]);
          return eq(column, value);
        }) as never;
      }
      return chain;
    }) as never;

    await clock.latePress(BOUT, 'start', offline(COPY_A));

    expect(asked).toEqual([
      ['select', 'ruleset_code, ruleset_version, ruleset_content_hash'],
      ['eq', 'id', COPY_A],
    ]);
  });
});

describe('a Start that keeps nothing', () => {
  it('pressed online: the bout takes its copy of now, and the other copy is logged', async () => {
    const { db, clock, warn } = start();

    // `false` said outright, as the schema allows: only `true` is evidence.
    await clock.latePress(BOUT, 'start', {
      ...press('10:00:00'),
      startedUnder: { rulesId: COPY_A },
      pressedWithoutNetwork: false,
    });

    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'running',
      started_at: at('10:00:00'),
    });
    expect(queriedTables(db.service.from)).not.toContain('match_rules');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('an online Start named copy'));
  });

  it('naming a copy this bout never held: its copy of now, logged', async () => {
    const { db, clock, warn } = start();

    await clock.latePress(BOUT, 'start', offline(NEVER));

    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'running',
      started_at: at('10:00:00'),
    });
    expect(queriedTables(db.service.from)).not.toContain('match_rules');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a copy this bout never held'));
  });

  it('naming no copy (a tablet of before), the flag alone: its copy of now, nothing logged', async () => {
    const { db, clock, warn } = start();

    await clock.latePress(BOUT, 'start', { ...press('10:00:00'), pressedWithoutNetwork: true });

    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'running',
      started_at: at('10:00:00'),
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('a copy that is not there, or names no engine: its copy of now, logged, never an error', async () => {
    for (const copies of [[], [{ ...COPIES[0]!, ruleset_code: '' }]]) {
      const { db, clock, warn } = start(MOVED, copies);

      await clock.latePress(BOUT, 'start', offline(COPY_A));

      expect(writesTo(db, 'matches')[0]?.row).toEqual({
        status: 'running',
        started_at: at('10:00:00'),
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not there or names no engine'));
    }
  });

  it('a Halt carrying both keys: they are not read', async () => {
    const { db, clock } = start({ status: 'running' }, COPIES, RUNNING);

    await clock.latePress(BOUT, 'halt', offline(COPY_A, '10:00:30'));

    expect(writesTo(db, 'matches').map((write) => write.row)).toEqual([{ status: 'paused' }]);
    expect(queriedTables(db.service.from)).not.toContain('match_rules');
  });
});

describe('a Start whose copy cannot be written', () => {
  it('a read of the copy that fails: an error, and no clock row', async () => {
    const built = setup(IDLE, MOVED);
    const real = built.db.service.from;
    built.db.service.from = vi.fn((table: string) =>
      table === 'match_rules'
        ? copiesTable({ error: { message: 'connection reset' } })
        : real(table),
    ) as never;

    await expect(built.clock.latePress(BOUT, 'start', offline(COPY_A))).rejects.toThrow(
      `Bout ${BOUT}: the copy its Start names was not read: connection reset`,
    );
    expect(writesTo(built.db, 'match_events')).toEqual([]);
    expect(writesTo(built.db, 'matches')).toEqual([]);
  });

  // The completion won between the door's read and its write: the row is taken back, as for any
  // press put in play (`writeBoutInPlay`), and no copy is said kept.
  it('a bout completed meanwhile: the clock row is taken back, nothing said kept', async () => {
    const { db, clock, bouts, warn } = start();
    const real = db.service.from;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      if (table !== 'match_events') return chain;
      const insert = chain.insert;
      chain.insert = vi.fn((written: unknown) => {
        bouts[0] = { ...bouts[0]!, status: 'completed' };
        return insert(written);
      }) as never;
      return chain;
    }) as never;

    await expect(clock.latePress(BOUT, 'start', offline(COPY_A))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'bout_completed' }),
    });

    expect(writesTo(db, 'match_events').map((write) => write.op)).toEqual(['insert', 'delete']);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('kept'));
  });

  // Another tablet's Start won the sequence; the retry finds the clock running and writes nothing.
  it('a collision whose retry finds the clock running: no copy written, nothing said kept', async () => {
    const { db, clock, rows, warn } = start();
    collide(db, 1, () => rows.push(row(1, 'start', '10:00:00')));

    await clock.latePress(BOUT, 'start', offline(COPY_A));

    expect(writesTo(db, 'matches')).toEqual([]);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('kept'));
  });
});

describe('a Start sent again whose bout write was lost', () => {
  const saved = { client_uuid: PRESS };

  it('finishes the bout on the copy the resend names', async () => {
    const { db, clock } = start(MOVED, COPIES, [row(1, 'start', '10:00:00', saved)]);

    await clock.latePress(BOUT, 'start', offline(COPY_A));

    expect(writesTo(db, 'match_events')).toEqual([]);
    expect(writesTo(db, 'matches')[0]?.row).toEqual({
      status: 'running',
      started_at: at('10:00:00'),
      match_rules_id: COPY_A,
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      ruleset_content_hash: 'hash-a',
    });
  });

  it('spends no read on a bout already started', async () => {
    const { db, clock } = start({ ...MOVED, status: 'running' }, COPIES, [
      row(1, 'start', '10:00:00', saved),
    ]);

    await clock.latePress(BOUT, 'start', offline(COPY_A));

    expect(writesTo(db, 'matches')).toEqual([]);
    expect(queriedTables(db.service.from)).not.toContain('match_rules');
  });
});

describe('the read of the door', () => {
  it('asks for the copy the bout holds and the copies it held', async () => {
    const { db, clock } = start();

    await clock.latePress(BOUT, 'start', offline(COPY_A));

    expect(selectsFor(db.service.from, 'matches')[0]).toBe(BOUT_COLUMNS);
    expect(BOUT_COLUMNS).toContain('match_rules_id, earlier_rules_ids');
    expect(filtersFor(db.service.from, 'matches', 'eq')[0]).toEqual(['id', BOUT]);
  });

  // `.select(BOUT_COLUMNS)` is no literal, so the schema gate skips it: a misspelled column would
  // be a PostgREST 400, read by the door as "Match not found".
  it('names only columns the migrations give `matches`', () => {
    const live = buildMigrationSchema().columns.get('matches')!;
    const own = columnsFromSelect(BOUT_COLUMNS, {});

    expect(own).toContain('earlier_rules_ids');
    expect(own.filter((column) => !live.has(column))).toEqual([]);
  });
});
