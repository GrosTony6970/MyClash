import { describe, expect, it } from 'vitest';
import { cardAsksFirst } from './card-asks-first';

describe('cardAsksFirst', () => {
  it('gives a yellow card at the tap', () => {
    expect(cardAsksFirst('yellow')).toBe(false);
  });

  it('asks before a red card', () => {
    expect(cardAsksFirst('red')).toBe(true);
  });

  it('asks before a black card', () => {
    expect(cardAsksFirst('black')).toBe(true);
  });

  it('gives a penalty with no card at the tap', () => {
    expect(cardAsksFirst(undefined)).toBe(false);
  });
});
