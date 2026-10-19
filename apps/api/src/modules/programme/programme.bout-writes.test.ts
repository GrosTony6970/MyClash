import { describe, expect, it, vi } from 'vitest';
import { lastFunctionBody, lastFunctionParams } from '../../common/testing/migration-function';
import type * as MatchLengths from '../schedule/match-lengths';
import { ProgrammeService } from './programme.service';

/**
 * The programme's two bout writes against the functions that run them (0231).
 *
 * A Supabase double ignores an rpc payload, and `rpc-function-conformance` checks only that the
 * name exists. So a key renamed on either side stays green everywhere while the database reads
 * that key as NULL and writes it onto every bout of a block or a cascade, and the count still says
 * every bout moved. This holds the two sides together: the call's parameters and each row's keys
 * against the LAST definition of the function.
 */

vi.mock('../schedule/match-lengths', async (importOriginal) => ({
  ...(await importOriginal<typeof MatchLengths>()),
  resolveMatchLengths: vi.fn((_db: unknown, _eventId: string, inputs: Array<{ id: string }>) =>
    Promise.resolve(new Map(inputs.map((input) => [input.id, 5]))),
  ),
}));

/** The field list of the function's `jsonb_to_recordset(...) as r(...)`. Refuses to find none. */
function recordsetFields(name: string): string[] {
  const body = lastFunctionBody(name);
  const open = body.indexOf('as r(');
  expect(open, `${name} does not expand a recordset`).toBeGreaterThan(-1);
  const fields = body
    .slice(open + 'as r('.length, body.indexOf(')', open))
    .split(',')
    .map((entry) => entry.trim().split(/\s+/u)[0] ?? '')
    .filter(Boolean);
  expect(fields.length).toBeGreaterThan(0);
  return fields.sort();
}

function chain(result: unknown) {
  const promise = Promise.resolve(result);
  const self = Object.assign(promise, {
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  }) as unknown as Record<string, unknown>;
  for (const key of ['select', 'eq', 'in', 'gte', 'lt', 'limit', 'order', 'update', 'not']) {
    self[key] = vi.fn().mockReturnValue(self);
  }
  return self;
}

function serviceWith(answer: { data: unknown; error: { message: string } | null }) {
  const from = vi.fn();
  const rpc = vi.fn((_fn: string, _args: { p_rows: Array<Record<string, unknown>> }) =>
    Promise.resolve(answer),
  );
  const service = new ProgrammeService(
    { service: { from, rpc } } as never,
    { assertOrgRole: vi.fn() } as never,
    { placeMatches: vi.fn() } as never,
  );
  vi.spyOn(
    service as never as { assertWriter: () => Promise<void> },
    'assertWriter',
  ).mockResolvedValue(undefined);
  return { service, from, rpc };
}

/** One Pool block of one bout, as Generate reads it, then its two bar writes. */
function queueGenerate(from: ReturnType<typeof vi.fn>) {
  from
    .mockReturnValueOnce(chain({ data: null, error: null })) // the sheet
    .mockReturnValueOnce(
      chain({
        data: [
          {
            id: 'block-1',
            event_id: 'event-1',
            day_index: 0,
            sort_order: 0,
            block_type: 'competition',
            label: 'Pools',
            competition_id: 'tournament-1',
            competition_phase: 'pool',
            workshop_id: null,
            lice_count: 1,
            start_time: '10:00',
            end_time: '10:30',
            generated_at: null,
          },
        ],
        error: null,
      }),
    )
    .mockReturnValueOnce(chain({ data: { start_date: '2026-05-21' }, error: null }))
    .mockReturnValueOnce(chain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null }))
    .mockReturnValueOnce(chain({ data: [], error: null })) // tournament_phase_venues
    .mockReturnValueOnce(chain({ data: [{ id: 'phase-1', type: 'pool' }], error: null }))
    .mockReturnValueOnce(chain({ data: [{ id: 'pool-1' }], error: null }))
    .mockReturnValueOnce(
      chain({
        data: [
          {
            id: 'match-1',
            red_registration_id: 'red-1',
            blue_registration_id: 'blue-1',
            pool_id: 'pool-1',
          },
        ],
        error: null,
      }),
    )
    .mockReturnValueOnce(chain({ data: null, error: null })) // realized-window sync
    .mockReturnValueOnce(chain({ data: null, error: null })); // generated_at stamp
}

function shifts(service: ProgrammeService) {
  return (
    service as never as { writeMatchShifts: (s: unknown[]) => Promise<number> }
  ).writeMatchShifts([
    { id: 'm1', scheduledAt: '2026-06-02T10:15:00.000Z' },
    { id: 'm2', scheduledAt: '2026-06-02T10:45:00.000Z' },
  ]);
}

describe('Generate places its bouts through programme_place_bouts', () => {
  it('sends the function its one parameter, and rows with exactly its record fields', async () => {
    const { service, from, rpc } = serviceWith({ data: 1, error: null });
    queueGenerate(from);

    await service.generate('event-1', {}, 'user-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe('programme_place_bouts');
    expect(Object.keys(args)).toEqual(lastFunctionParams('programme_place_bouts'));
    expect(args.p_rows.length).toBeGreaterThan(0);
    for (const row of args.p_rows) {
      expect(Object.keys(row).sort()).toEqual(recordsetFields('programme_place_bouts'));
    }
  });

  it('reports the bouts the database moved, not the ones it was asked to move', async () => {
    const { service, from } = serviceWith({ data: 0, error: null });
    queueGenerate(from);

    const result = await service.generate('event-1', {}, 'user-1');

    expect(result.matchesScheduled).toBe(0);
  });

  it('refuses an answer that is no count', async () => {
    const { service, from } = serviceWith({ data: null, error: null });
    queueGenerate(from);

    await expect(service.generate('event-1', {}, 'user-1')).rejects.toThrow(
      'programme_place_bouts answered no count of the bouts it moved',
    );
  });
});

describe('A cascade retimes its bouts through programme_retime_bouts', () => {
  it('sends the function its one parameter, and rows with exactly its record fields', async () => {
    const { service, rpc } = serviceWith({ data: 2, error: null });

    await shifts(service);

    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe('programme_retime_bouts');
    expect(Object.keys(args)).toEqual(lastFunctionParams('programme_retime_bouts'));
    expect(args.p_rows).toHaveLength(2);
    for (const row of args.p_rows) {
      expect(Object.keys(row).sort()).toEqual(recordsetFields('programme_retime_bouts'));
    }
  });

  it('reports the bouts the database moved', async () => {
    const { service } = serviceWith({ data: 1, error: null });

    await expect(shifts(service)).resolves.toBe(1);
  });

  it('refuses an answer that is no count', async () => {
    const { service } = serviceWith({ data: [{ id: 'm1' }], error: null });

    await expect(shifts(service)).rejects.toThrow(
      'programme_retime_bouts answered no count of the bouts it moved',
    );
  });
});
