import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { buildUnifiedTimeline, exchangeOptionLabel, orderedWithNumbers } from './exchange-timeline';
import type { ExchangeRow, Penalty } from '../types/match-events';

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

  const base = {
    redName: 'Red Fighter',
    blueName: 'Blue Fighter',
    redRegId: 'reg-red',
    blueRegId: 'reg-blue',
    t,
    config: DEFAULT_SCORING_CONFIG,
  };

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
