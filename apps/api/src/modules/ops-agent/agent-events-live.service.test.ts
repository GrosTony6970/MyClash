import { describe, expect, it } from 'vitest';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { AgentEventsLiveService, EVENTS_UNREADABLE_CODE } from './agent-events-live.service';

/**
 * "Is an Event live?" for the ops agent (rulings 882, 883): any sign counts — the status
 * `running`, a bout in play, today within the dates — for an Event not over and not a test one.
 */
type Row = Record<string, unknown>;
interface Call {
  table: string;
  select: string;
  filters: Array<[string, readonly unknown[]]>;
}

/** A Supabase double that records each read's select and `in` filters, and applies the filters. */
function doubleDb(tables: Record<string, Row[]>, failing?: string) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, select: '', filters: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.select = columns;
        return builder;
      },
      in(column: string, values: readonly unknown[]) {
        call.filters.push([column, values]);
        return builder;
      },
      then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
        if (table === failing) {
          return Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve, reject);
        }
        const data = (tables[table] ?? []).filter((row) =>
          call.filters.every(([column, values]) => values.includes(row[column])),
        );
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return { calls, supabase: { service: { from } } as never };
}

const EVENT_COLUMNS = 'id, name, status, start_date, end_date, timezone, event_kind';
const NOW = new Date('2026-11-21T23:30:00Z'); // already the 22nd in Paris (UTC+1)

const event = (over: Row): Row => ({
  id: 'e1',
  name: 'Open de Lyon',
  status: 'published',
  start_date: '2026-12-05',
  end_date: '2026-12-06',
  timezone: 'Europe/Paris',
  event_kind: 'standard',
  ...over,
});

async function read(tables: Record<string, Row[]>, failing?: string) {
  const { calls, supabase } = doubleDb(tables, failing);
  const answer = await new AgentEventsLiveService(supabase).read(NOW);
  return { answer, calls };
}

describe('AgentEventsLiveService.read', () => {
  it('reads the Events not over, every kind, with these columns', async () => {
    const { calls } = await read({});
    expect(calls[0]).toEqual({
      table: 'events',
      select: EVENT_COLUMNS,
      filters: [['status', ['draft', 'published', 'running']]],
    });
  });

  it('a running Event is live by its status', async () => {
    const { answer } = await read({ events: [event({ status: 'running' })] });
    expect(answer.live).toBe(true);
    expect(answer.events).toEqual([
      { id: 'e1', name: 'Open de Lyon', status: 'running', signs: ['status'] },
    ]);
  });

  it("today counts in the Event's own zone", async () => {
    const today = await read({
      events: [event({ start_date: '2026-11-22', end_date: '2026-11-22' })],
    });
    expect(today.answer.events[0]?.signs).toEqual(['dates']);
    const yesterday = await read({
      events: [event({ start_date: '2026-11-21', end_date: '2026-11-21' })],
    });
    expect(yesterday.answer.live).toBe(false);
  });

  it('a draft club Event whose dates hold today is live (ruling 882: any sign)', async () => {
    const { answer } = await read({
      events: [
        event({
          status: 'draft',
          event_kind: 'club',
          start_date: '2026-11-20',
          end_date: '2026-11-23',
        }),
      ],
    });
    expect(answer.events[0]?.signs).toEqual(['dates']);
  });

  it('a running test Event is not live (ruling 883)', async () => {
    const { answer } = await read({ events: [event({ status: 'running', event_kind: 'test' })] });
    expect(answer).toMatchObject({ live: false, events: [] });
  });

  it('a bout in play makes its Event live, read through phases and tournaments', async () => {
    const { answer, calls } = await read({
      matches: [{ phase_id: 'p1', status: 'paused' }],
      phases: [{ id: 'p1', tournament_id: 't1' }],
      tournaments: [{ id: 't1', event_id: 'e1' }],
      events: [event({ status: 'draft' })],
    });
    expect(calls.slice(1)).toEqual([
      { table: 'matches', select: 'phase_id', filters: [['status', ['running', 'paused']]] },
      { table: 'phases', select: 'id, tournament_id', filters: [['id', ['p1']]] },
      { table: 'tournaments', select: 'id, event_id', filters: [['id', ['t1']]] },
      { table: 'events', select: EVENT_COLUMNS, filters: [['id', ['e1']]] },
    ]);
    expect(answer.events).toEqual([
      { id: 'e1', name: 'Open de Lyon', status: 'draft', signs: ['bout'] },
    ]);
  });

  it('a bout in play in an Event that is over, or a test one, does not count', async () => {
    for (const over of [{ status: 'completed' }, { status: 'archived' }, { event_kind: 'test' }]) {
      const { answer } = await read({
        matches: [{ phase_id: 'p1', status: 'running' }],
        phases: [{ id: 'p1', tournament_id: 't1' }],
        tournaments: [{ id: 't1', event_id: 'e1' }],
        events: [event({ status: 'running', ...over })],
      });
      expect(answer.live, JSON.stringify(over)).toBe(false);
    }
  });

  it('no bout in play: no further read', async () => {
    const { calls } = await read({ events: [event({})] });
    expect(calls.map((c) => c.table)).toEqual(['events', 'matches']);
  });

  it('an Event with several signs lists each once', async () => {
    const { answer } = await read({
      events: [event({ status: 'running', start_date: '2026-11-22', end_date: '2026-11-22' })],
      matches: [{ phase_id: 'p1', status: 'running' }],
      phases: [{ id: 'p1', tournament_id: 't1' }],
      tournaments: [{ id: 't1', event_id: 'e1' }],
    });
    expect(answer.events).toEqual([
      { id: 'e1', name: 'Open de Lyon', status: 'running', signs: ['status', 'bout', 'dates'] },
    ]);
  });

  it('a read that fails is a 503 with a code the run reads, never "not live"', async () => {
    for (const table of ['events', 'matches', 'phases', 'tournaments']) {
      const error = await read(
        {
          matches: [{ phase_id: 'p1', status: 'running' }],
          phases: [{ id: 'p1', tournament_id: 't1' }],
          tournaments: [{ id: 't1', event_id: 'e1' }],
        },
        table,
      ).catch((e: unknown) => e);
      expect(error, table).toBeInstanceOf(OperationalUnavailableException);
      expect((error as OperationalUnavailableException).getResponse(), table).toMatchObject({
        code: EVENTS_UNREADABLE_CODE,
      });
    }
  });
});
