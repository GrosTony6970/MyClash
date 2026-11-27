import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { buildUnifiedTimeline } from './exchange-timeline';
import type { ExchangeRow, MatchProtest } from '../types/match-events';

/**
 * On a stopped clock, two protests by one Fighter were two identical rows: same time, same name,
 * same word. An undo took the newest, and the list looked as if the older one went. Each row now
 * says which of the Fighter's protests it is ("Protest 2"); hits and cards keep their `#N`.
 */
describe("a protest is numbered among its Fighter's protests", () => {
  // A `t` that writes the number, so the test reads it and not only the key.
  const t = (k: string, p?: Record<string, string>) => (p?.['n'] ? `${k} ${p['n']}` : k);

  const hit = (id: string, sequence: number): ExchangeRow => ({
    id,
    sequence,
    type: 'clean',
    voided: false,
    occurredAt: `2027-06-21T10:0${sequence}:00.000Z`,
    scoringSide: 'red',
    scoreDelta: 1,
  });

  const protest = (
    over: Partial<MatchProtest> & Pick<MatchProtest, 'id' | 'sequence' | 'occurred_at'>,
  ): MatchProtest => ({
    client_uuid: `uuid-${over.id}`,
    match_id: 'match-1',
    registration_id: 'reg-red',
    round_number: 1,
    clock_time_ms: 12_000,
    voided: false,
    ...over,
  });

  const timeline = (protests: MatchProtest[], exchanges: ExchangeRow[] = []) =>
    buildUnifiedTimeline({
      exchanges,
      penalties: [],
      protests,
      redName: 'Red Fighter',
      blueName: 'Blue Fighter',
      redRegId: 'reg-red',
      blueRegId: 'reg-blue',
      t,
      config: DEFAULT_SCORING_CONFIG,
    });

  const numbered = (rows: ReturnType<typeof buildUnifiedTimeline>) =>
    rows.filter((e) => e.kind === 'protest').map((e) => `${e.rawId}:${e.typeLabel}`);

  it("counts each Fighter's protests apart, in the list's order", () => {
    const out = timeline(
      // Given out of order: the number follows the time, not the array.
      [
        protest({
          id: 'b1',
          sequence: 5,
          occurred_at: '2027-06-21T10:02:40.000Z',
          registration_id: 'reg-blue',
        }),
        protest({ id: 'r2', sequence: 4, occurred_at: '2027-06-21T10:02:30.000Z' }),
        protest({ id: 'r1', sequence: 3, occurred_at: '2027-06-21T10:01:30.000Z' }),
      ],
      [hit('e1', 1), hit('e2', 2)],
    );
    expect(numbered(out)).toEqual([
      'b1:scoring.lice.eventRowProtest 1',
      'r2:scoring.lice.eventRowProtest 2',
      'r1:scoring.lice.eventRowProtest 1',
    ]);
    // The hits keep their own #N.
    expect(out.filter((e) => e.kind === 'exchange').map((e) => e.number)).toEqual([2, 1]);
  });

  it('numbers two protests of one moment by their sequence', () => {
    const at = '2027-06-21T10:02:00.000Z';
    const out = timeline([
      protest({ id: 'late', sequence: 7, occurred_at: at }),
      protest({ id: 'early', sequence: 6, occurred_at: at }),
    ]);
    expect(numbered(out)).toEqual([
      'late:scoring.lice.eventRowProtest 2',
      'early:scoring.lice.eventRowProtest 1',
    ]);
  });

  it('skips a voided protest, and counts one waiting on the tablet', () => {
    const out = timeline([
      protest({ id: 'gone', sequence: 1, occurred_at: '2027-06-21T10:01:00.000Z', voided: true }),
      protest({ id: 'kept', sequence: 2, occurred_at: '2027-06-21T10:02:00.000Z' }),
      protest({
        id: 'queued',
        sequence: 3,
        occurred_at: '2027-06-21T10:03:00.000Z',
        pending: true,
      }),
    ]);
    expect(numbered(out)).toEqual([
      'queued:scoring.lice.eventRowProtest 2',
      'kept:scoring.lice.eventRowProtest 1',
    ]);
  });
});
