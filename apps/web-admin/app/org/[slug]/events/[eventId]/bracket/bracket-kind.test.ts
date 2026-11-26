import { describe, expect, it } from 'vitest';
import {
  offeredPhaseTypes,
  offeredStrategies,
  offeredValue,
  slotOverrideBody,
} from './bracket-kind';

describe('what the bracket dialogs send for the kind', () => {
  it('sends a hidden pick as the first offered value', () => {
    // A double elimination read from another Tournament's bracket stays in the page's state.
    expect(offeredValue('double_elim', offeredPhaseTypes('team'))).toBe('single_elim');
    expect(offeredValue('by-rating', offeredStrategies('team'))).toBe('snake');
  });

  it('keeps an offered pick', () => {
    expect(offeredValue('double_elim', offeredPhaseTypes('individual'))).toBe('double_elim');
    expect(offeredValue('random', offeredStrategies('team'))).toBe('random');
  });
});

describe('slotOverrideBody', () => {
  it('names a team side by its team, and only the changed sides', () => {
    expect(slotOverrideBody('team', 'tm1', undefined)).toEqual({ teamAId: 'tm1' });
    expect(slotOverrideBody('team', undefined, null)).toEqual({ teamBId: null });
  });

  it('names a Fighter side by its Registration', () => {
    expect(slotOverrideBody('individual', 'r1', 'r2')).toEqual({
      registrationAId: 'r1',
      registrationBId: 'r2',
    });
  });
});
