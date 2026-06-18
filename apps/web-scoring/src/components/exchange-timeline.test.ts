import { describe, expect, it } from 'vitest';
import { exchangeOptionLabel, orderedWithNumbers } from './exchange-timeline';

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
