import { describe, it, expect } from 'vitest';
import { forfeitEndReason } from './forfeit-end-reason';

describe('forfeitEndReason', () => {
  it('maps a first black card to black_card', () => {
    expect(forfeitEndReason('black_card_1')).toBe('black_card');
  });

  it('maps a second black card to black_card', () => {
    expect(forfeitEndReason('black_card_2')).toBe('black_card');
  });

  it('maps a non-black-card forfeit reason to forfeit', () => {
    expect(forfeitEndReason('injury')).toBe('forfeit');
    expect(forfeitEndReason('voluntary')).toBe('forfeit');
    expect(forfeitEndReason('conduct_violation')).toBe('forfeit');
  });
});
