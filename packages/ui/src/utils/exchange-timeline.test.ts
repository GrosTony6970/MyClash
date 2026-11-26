import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import {
  buildUnifiedTimeline,
  exchangeOptionLabel,
  orderedWithNumbers,
  rowSide,
} from './exchange-timeline';
import type { ExchangeRow, MatchProtest, Penalty } from '../types/match-events';

function row<E extends object>(seq: number, occurredAt: string, extra: E = {} as E) {
  return { seq, occurredAt, ...extra };
}

describe('orderedWithNumbers', () => {
  it('returns an empty list unchanged', () => {
    expect(orderedWithNumbers([])).toEqual([]);
  });

  it('numbers chronologically 1..N and returns newest-first', () => {
    const out = orderedWithNumbers([
      row(3, '2027-06-21T10:31:00.000Z', { tag: 'c' }),
      row(1, '2027-06-21T10:09:00.000Z', { tag: 'a' }),
      row(2, '2027-06-21T10:14:00.000Z', { tag: 'b' }),
    ]);
    // Display order is newest-first…
    expect(out.map((r) => r.tag)).toEqual(['c', 'b', 'a']);
    // …but the numbers were assigned chronologically.
    expect(out.map((r) => `${r.tag}:${r.number}`)).toEqual(['c:3', 'b:2', 'a:1']);
  });

  it('numbers exchanges and cards as one contiguous sequence', () => {
    const out = orderedWithNumbers([
      row(1, '2027-06-21T10:09:00.000Z', { kind: 'exchange' }),
      row(2, '2027-06-21T10:14:00.000Z', { kind: 'exchange' }),
      row(3, '2027-06-21T10:26:00.000Z', { kind: 'penalty' }), // a card
      row(4, '2027-06-21T10:36:00.000Z', { kind: 'exchange' }),
    ]);
    // The card is numbered #3 — it counts as part of the sequence, no gaps.
    const byNumber = [...out].sort((a, b) => a.number - b.number);
    expect(byNumber.map((r) => `${r.number}:${r.kind}`)).toEqual([
      '1:exchange',
      '2:exchange',
      '3:penalty',
      '4:exchange',
    ]);
  });

  it('breaks ties on equal occurredAt by stored seq', () => {
    const out = orderedWithNumbers([
      row(5, '2027-06-21T10:36:00.000Z', { tag: 'card' }),
      row(4, '2027-06-21T10:36:00.000Z', { tag: 'ab' }),
    ]);
    // Ascending numbering uses seq as the tiebreak: ab(seq4)=#1, card(seq5)=#2.
    const byNumber = [...out].sort((a, b) => a.number - b.number);
    expect(byNumber.map((r) => `${r.tag}:${r.number}`)).toEqual(['ab:1', 'card:2']);
  });

  it('keeps a net-zero (1-1) afterblow row in the sequence', () => {
    const out = orderedWithNumbers([
      row(1, '2027-06-21T10:09:00.000Z', { type: 'clean' }),
      row(2, '2027-06-21T10:14:00.000Z', { type: 'afterblow', delta: '+0' }),
    ]);
    const ab = out.find((r) => r.type === 'afterblow');
    expect(ab).toBeDefined();
    expect(ab?.number).toBe(2);
  });

  // Supabase realtime passes `timestamptz` through as raw Postgres wire text
  // (space separator, `+00` offset) while PostgREST renders ISO-8601. A string
  // comparison puts ' ' before 'T', which numbered every live-inserted row #1
  // and rendered it at the BOTTOM of the newest-first list.
  it('orders by instant, not by timestamp spelling', () => {
    const out = orderedWithNumbers([
      row(1, '2027-06-21T10:09:00.000+00:00', { tag: 'api-oldest' }),
      row(2, '2027-06-21T10:14:00.000+00:00', { tag: 'api-middle' }),
      row(3, '2027-06-21 10:31:00.5+00', { tag: 'realtime-newest' }),
    ]);
    expect(out.map((r) => r.tag)).toEqual(['realtime-newest', 'api-middle', 'api-oldest']);
    expect(out.map((r) => r.number)).toEqual([3, 2, 1]);
  });

  // PostgREST omits the fractional part on a whole second, and '+' sorts after
  // '.' lexically — so the earlier event used to be numbered second.
  it('orders a whole second before a fraction of the same second', () => {
    const out = orderedWithNumbers([
      row(2, '2027-06-21T10:31:00.400+00:00', { tag: 'later' }),
      row(1, '2027-06-21T10:31:00+00:00', { tag: 'earlier' }),
    ]);
    expect(out.map((r) => r.tag)).toEqual(['later', 'earlier']);
  });

  it('sorts an unparseable timestamp last rather than letting it steal #1', () => {
    const out = orderedWithNumbers([
      row(1, '2027-06-21T10:09:00.000Z', { tag: 'real' }),
      row(2, '', { tag: 'legacy' }),
    ]);
    expect(out.find((r) => r.tag === 'real')?.number).toBe(1);
    expect(out.find((r) => r.tag === 'legacy')?.number).toBe(2);
  });
});

describe('buildUnifiedTimeline', () => {
  const t = (k: string) => k;

  function ex(over: Partial<ExchangeRow> & Pick<ExchangeRow, 'id' | 'sequence'>): ExchangeRow {
    return {
      type: 'clean',
      voided: false,
      occurredAt: `2027-06-21T10:0${over.sequence}:00.000Z`,
      scoringSide: 'red',
      scoreDelta: 1,
      ...over,
    };
  }

  function pen(over: Partial<Penalty> & Pick<Penalty, 'id' | 'sequence'>): Penalty {
    return {
      registration_id: 'reg-red',
      team_id: null,
      card: 'yellow',
      source: 'ruleset',
      short_name: 'Sortie de lice',
      reason: null,
      score_delta: 0,
      causes_match_forfeit: false,
      voided: false,
      occurred_at: `2027-06-21T10:0${over.sequence}:00.000Z`,
      ...over,
    };
  }

  function pro(
    over: Partial<MatchProtest> & Pick<MatchProtest, 'id' | 'sequence' | 'occurred_at'>,
  ): MatchProtest {
    return {
      client_uuid: `uuid-${over.id}`,
      match_id: 'match-1',
      registration_id: 'reg-blue',
      team_id: null,
      round_number: 1,
      clock_time_ms: 12_000,
      voided: false,
      ...over,
    };
  }

  const base = {
    protests: [] as MatchProtest[],
    redName: 'Red Fighter',
    blueName: 'Blue Fighter',
    redSideId: 'reg-red',
    blueSideId: 'reg-blue',
    t,
    config: DEFAULT_SCORING_CONFIG,
  };

  /**
   * `pending` marks a row the referee scored that is still queued on the
   * tablet. Only the pad ever sets it — nothing server-side does — but the
   * builder has to carry it through, because the pad merges its outbox into
   * the same list the timeline renders. It must default to false rather than
   * undefined so a surface reading it cannot mistake "not set" for "unknown".
   */
  it('carries a pending flag through, defaulting to false', () => {
    const out = buildUnifiedTimeline({
      ...base,
      exchanges: [ex({ id: 'e1', sequence: 1 }), ex({ id: 'e2', sequence: 2, pending: true })],
      penalties: [pen({ id: 'p1', sequence: 3, pending: true })],
    });

    const byRawId = new Map(out.map((e) => [e.rawId, e.pending]));
    expect(byRawId.get('e1')).toBe(false);
    expect(byRawId.get('e2')).toBe(true);
    expect(byRawId.get('p1')).toBe(true);
  });

  it('drops voided exchanges AND voided cards, then renumbers 1..N with no gaps', () => {
    const out = buildUnifiedTimeline({
      ...base,
      exchanges: [
        ex({ id: 'e1', sequence: 1 }),
        ex({ id: 'e2', sequence: 2, voided: true }),
        ex({ id: 'e3', sequence: 3 }),
      ],
      penalties: [pen({ id: 'p1', sequence: 4, voided: true }), pen({ id: 'p2', sequence: 5 })],
    });
    expect(out.map((e) => e.rawId)).toEqual(['p2', 'e3', 'e1']);
    // Contiguous — a voided row must not leave a hole in the numbering, or the
    // pad, the display and the public page stop agreeing on what "#2" means.
    expect([...out].map((e) => e.number).sort()).toEqual([1, 2, 3]);
  });

  it('names a direct card instead of rendering a blank label', () => {
    const [event] = buildUnifiedTimeline({
      ...base,
      exchanges: [],
      penalties: [pen({ id: 'p1', sequence: 1, source: 'direct', short_name: null, reason: null })],
    });
    expect(event?.typeLabel).toBe('scoring.liveMatch.directCard');
  });

  it('translates a no-exchange reason id rather than printing the raw token', () => {
    const [event] = buildUnifiedTimeline({
      ...base,
      exchanges: [
        ex({ id: 'e1', sequence: 1, type: 'no_exchange', no_exchange_reason: 'out_of_bounds' }),
      ],
      penalties: [],
    });
    expect(event?.note).toBe('scoring.pad.noExchangeReasons.outOfBounds');
  });

  it('passes unknown free-text reasons through unchanged (legacy rows)', () => {
    const [event] = buildUnifiedTimeline({
      ...base,
      exchanges: [
        ex({ id: 'e1', sequence: 1, type: 'no_exchange', no_exchange_reason: 'blade broke' }),
      ],
      penalties: [],
    });
    expect(event?.note).toBe('blade broke');
  });

  it('leaves the fighter slot empty on a double — there is no scorer to name', () => {
    const [event] = buildUnifiedTimeline({
      ...base,
      exchanges: [ex({ id: 'e1', sequence: 1, type: 'double', scoringSide: null })],
      penalties: [],
    });
    expect(event?.fighterLabel).toBe('');
    expect(event?.typeLabel).toBe('scoring.lice.eventRowDouble');
  });

  describe('a protest', () => {
    const hits = [1, 2, 3, 4].map((n) => ex({ id: `e${n}`, sequence: n }));
    const card = pen({ id: 'p1', sequence: 5 });
    // Between hit 2 (10:02) and hit 3 (10:03). Its sequence is its own table's.
    const protest = pro({ id: 'pr1', sequence: 1, occurred_at: '2027-06-21T10:02:30.000Z' });

    it('carries no number, and the hits and cards around it keep theirs', () => {
      const without = buildUnifiedTimeline({ ...base, exchanges: hits, penalties: [card] });
      const withIt = buildUnifiedTimeline({
        ...base,
        exchanges: hits,
        penalties: [card],
        protests: [protest],
      });

      const numbers = (rows: typeof withIt) =>
        rows.filter((e) => e.kind !== 'protest').map((e) => `${e.rawId}:${e.number}`);
      expect(numbers(withIt)).toEqual(numbers(without));
      expect(numbers(withIt)).toEqual(['p1:5', 'e4:4', 'e3:3', 'e2:2', 'e1:1']);

      const row = withIt.find((e) => e.kind === 'protest');
      expect(row).toMatchObject({
        id: 'pro-pr1',
        kind: 'protest',
        rawId: 'pr1',
        number: null,
        delta: null,
        card: null,
        side: 'blue',
        fighterLabel: 'Blue Fighter',
        typeLabel: 'scoring.lice.eventRowProtest',
        timeLabel: '00:12',
        pending: false,
      });
      // Newest first, in its place by time.
      expect(withIt.map((e) => e.rawId)).toEqual(['p1', 'e4', 'e3', 'pr1', 'e2', 'e1']);
    });

    it('takes its place by time, then by sequence', () => {
      const out = buildUnifiedTimeline({
        ...base,
        exchanges: [ex({ id: 'e1', sequence: 1 }), ex({ id: 'e2', sequence: 2 })],
        penalties: [],
        protests: [
          pro({ id: 'pA', sequence: 1, occurred_at: '2027-06-21T10:02:00.000Z' }),
          pro({ id: 'pB', sequence: 3, occurred_at: '2027-06-21T10:02:00.000Z' }),
          pro({ id: 'pC', sequence: 9, occurred_at: '2027-06-21T10:00:30.000Z' }),
        ],
      });
      expect(out.map((e) => e.rawId)).toEqual(['pB', 'e2', 'pA', 'e1', 'pC']);
      expect(out.map((e) => e.number)).toEqual([null, 2, null, 1, null]);
    });

    it('is dropped when voided', () => {
      const out = buildUnifiedTimeline({
        ...base,
        exchanges: hits,
        penalties: [],
        protests: [{ ...protest, voided: true }],
      });
      expect(out.some((e) => e.kind === 'protest')).toBe(false);
    });

    it('carries pending: true when it waits on the tablet', () => {
      const out = buildUnifiedTimeline({
        ...base,
        exchanges: [],
        penalties: [],
        protests: [{ ...protest, pending: true }],
      });
      expect(out[0]?.pending).toBe(true);
    });

    it('is worded for the drawer with no #null', () => {
      const [row] = buildUnifiedTimeline({
        ...base,
        exchanges: [],
        penalties: [],
        protests: [protest],
      });
      const label = exchangeOptionLabel(row!);
      expect(label).not.toContain('#');
      expect(label).toBe('00:12 · Blue Fighter · scoring.lice.eventRowProtest');
    });
  });
});

describe('exchangeOptionLabel', () => {
  it('composes #number · time · fighter · type with a trailing delta', () => {
    expect(
      exchangeOptionLabel({
        number: 4,
        timeLabel: '00:36',
        fighterLabel: 'Anthony Garnier',
        typeLabel: 'AB',
        delta: '+1',
      }),
    ).toBe('#4 · 00:36 · Anthony Garnier · AB +1');
  });

  it('still shows a +0 delta', () => {
    expect(
      exchangeOptionLabel({
        number: 5,
        timeLabel: '00:40',
        fighterLabel: '—',
        typeLabel: 'AB',
        delta: '+0',
      }),
    ).toBe('#5 · 00:40 · — · AB +0');
  });

  it('omits the delta segment when there is none (double / no-exchange)', () => {
    expect(
      exchangeOptionLabel({
        number: 8,
        timeLabel: '01:24',
        fighterLabel: 'Double',
        typeLabel: 'Double',
        delta: null,
      }),
    ).toBe('#8 · 01:24 · Double · Double');
  });

  it('drops an empty time segment (legacy rows without a clock time)', () => {
    expect(
      exchangeOptionLabel({
        number: 2,
        timeLabel: '',
        fighterLabel: 'Jane',
        typeLabel: 'clean',
        delta: '+1',
      }),
    ).toBe('#2 · Jane · clean +1');
  });
});

describe('rowSide', () => {
  const fighter = (id: string | null | undefined) => ({ registration_id: id, team_id: null });

  it('names the side whose Registration the row carries', () => {
    expect(rowSide(fighter('reg-red'), 'reg-red', 'reg-blue')).toBe('red');
    expect(rowSide(fighter('reg-blue'), 'reg-red', 'reg-blue')).toBe('blue');
    expect(rowSide(fighter('reg-other'), 'reg-red', 'reg-blue')).toBeNull();
  });

  // A side waiting for a Fighter has no key: null is nobody, a row with none included.
  it('gives a row with no side to no side, a side with none included', () => {
    expect(rowSide(fighter(null), null, 'reg-blue')).toBeNull();
    expect(rowSide(fighter(undefined), 'reg-red', null)).toBeNull();
    expect(rowSide(fighter(null), null, null)).toBeNull();
    expect(rowSide(fighter('reg-blue'), null, 'reg-blue')).toBe('blue');
  });
});
