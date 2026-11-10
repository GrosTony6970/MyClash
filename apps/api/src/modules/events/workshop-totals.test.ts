import { describe, expect, it } from 'vitest';
import { readWorkshopTotals } from './workshop-totals';

type Answer = { data?: unknown; count?: number | null; error: { message: string } | null };

/**
 * A double that RECORDS what each read asked for: the select string and its options, every `.eq`
 * and every `.in`. A double that ignored them could not prove which rows are counted. A read is
 * answered by `table:status` when it filters on a status (the head counts), else by `table`.
 */
function recordingDb(answers: Record<string, Answer>) {
  const reads: Array<{
    table: string;
    select?: string;
    options?: unknown;
    eq: Array<[string, unknown]>;
    in: Array<[string, unknown[]]>;
  }> = [];
  const db = {
    from(table: string) {
      const read = {
        table,
        eq: [] as Array<[string, unknown]>,
        in: [] as Array<[string, unknown[]]>,
      };
      reads.push(read);
      const chain = {
        select(columns: string, options?: unknown) {
          Object.assign(read, { select: columns }, options === undefined ? {} : { options });
          return chain;
        },
        eq(column: string, value: unknown) {
          read.eq.push([column, value]);
          return chain;
        },
        in(column: string, values: unknown[]) {
          read.in.push([column, values]);
          return chain;
        },
        then(resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) {
          const status = read.eq.find(([column]) => column === 'status')?.[1];
          const answer = answers[status ? `${table}:${String(status)}` : table];
          if (!answer)
            return Promise.reject(new Error(`unexpected read of ${table}`)).then(resolve, reject);
          return Promise.resolve(answer).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as never, reads };
}

const ok = (data: unknown): Answer => ({ data, error: null });
const counted = (count: number): Answer => ({ data: null, count, error: null });
const NO_BOOKINGS = {
  'workshop_enrollments:confirmed': counted(0),
  'workshop_enrollments:waitlisted': counted(0),
};

describe('readWorkshopTotals — the Workshop cards of the Event overview', () => {
  it("reads the Event's Workshops with their sessions' status", async () => {
    const { db, reads } = recordingDb({ workshops: ok([]) });
    await readWorkshopTotals(db, 'event-1');
    expect(reads[0]).toEqual({
      table: 'workshops',
      select: 'id, capacity, workshop_sessions ( id, status )',
      eq: [['event_id', 'event-1']],
      in: [],
    });
  });

  it('counts seats taken and waitlists in live sessions only; a cancelled session counts nowhere', async () => {
    const { db, reads } = recordingDb({
      workshops: ok([
        {
          capacity: 12,
          workshop_sessions: [
            { id: 's-sat', status: 'scheduled' },
            { id: 's-sun', status: 'cancelled' },
          ],
        },
        { capacity: 20, workshop_sessions: [{ id: 's-dag', status: 'running' }] },
      ]),
      'workshop_enrollments:confirmed': counted(3),
      'workshop_enrollments:waitlisted': counted(1),
    });

    await expect(readWorkshopTotals(db, 'event-1')).resolves.toEqual({
      workshops: 2,
      sessions: 2,
      seatsTaken: 3,
      seats: 32,
      waitlisted: 1,
    });
    // Head counts (no rows, so no 1000-row cap), over the live sessions only.
    const countRead = (status: string) => ({
      table: 'workshop_enrollments',
      select: 'id',
      options: { count: 'exact', head: true },
      eq: [['status', status]],
      in: [['workshop_session_id', ['s-sat', 's-dag']]],
    });
    expect(reads.slice(1)).toEqual([countRead('confirmed'), countRead('waitlisted')]);
  });

  it('adds the seats of every session: two sessions of 12 make 24', async () => {
    const { db } = recordingDb({
      workshops: ok([
        {
          capacity: 12,
          workshop_sessions: [
            { id: 's-1', status: 'scheduled' },
            { id: 's-2', status: 'running' },
          ],
        },
      ]),
      ...NO_BOOKINGS,
    });
    await expect(readWorkshopTotals(db, 'event-1')).resolves.toMatchObject({
      sessions: 2,
      seats: 24,
    });
  });

  it('has no seat total when one live session has no limit', async () => {
    const { db } = recordingDb({
      workshops: ok([
        { capacity: 12, workshop_sessions: [{ id: 's-1', status: 'scheduled' }] },
        { capacity: null, workshop_sessions: [{ id: 's-2', status: 'scheduled' }] },
      ]),
      ...NO_BOOKINGS,
    });
    await expect(readWorkshopTotals(db, 'event-1')).resolves.toMatchObject({ seats: null });
  });

  it('keeps the seat total when only a cancelled session has no limit', async () => {
    const { db } = recordingDb({
      workshops: ok([
        { capacity: 12, workshop_sessions: [{ id: 's-1', status: 'scheduled' }] },
        { capacity: null, workshop_sessions: [{ id: 's-2', status: 'cancelled' }] },
      ]),
      ...NO_BOOKINGS,
    });
    await expect(readWorkshopTotals(db, 'event-1')).resolves.toMatchObject({ seats: 12 });
  });

  it('reads no booking and has no seat total when no session is live ("0 / 0" reads as full)', async () => {
    const { db, reads } = recordingDb({
      workshops: ok([
        { capacity: 12, workshop_sessions: [] },
        { capacity: 8, workshop_sessions: [{ id: 's-1', status: 'cancelled' }] },
      ]),
    });
    await expect(readWorkshopTotals(db, 'event-1')).resolves.toEqual({
      workshops: 2,
      sessions: 0,
      seatsTaken: 0,
      seats: null,
      waitlisted: 0,
    });
    expect(reads.map((r) => r.table)).toEqual(['workshops']);
  });

  it('throws when the Workshops cannot be read, rather than saying there are none', async () => {
    const { db } = recordingDb({ workshops: { data: null, error: { message: 'boom' } } });
    await expect(readWorkshopTotals(db, 'event-1')).rejects.toThrow(/were not counted: boom/);
  });

  it('throws when a booking count fails, rather than saying every seat is free', async () => {
    const { db } = recordingDb({
      workshops: ok([{ capacity: 12, workshop_sessions: [{ id: 's-1', status: 'scheduled' }] }]),
      'workshop_enrollments:confirmed': { count: null, error: { message: 'boom' } },
      'workshop_enrollments:waitlisted': counted(0),
    });
    await expect(readWorkshopTotals(db, 'event-1')).rejects.toThrow(
      /confirmed bookings .* not counted: boom/,
    );
  });
});
