import { describe, expect, it } from 'vitest';
import { INITIAL, wizardDirty } from './wizard-state';

/** O12 (ruled 2026-10-14): what the new-Event wizard would lose on leaving. */
describe('wizardDirty', () => {
  it('holds nothing for the empty form, on any step', () => {
    expect(wizardDirty(INITIAL, false)).toBe(false);
    expect(wizardDirty({ ...INITIAL, step: 3, submitting: true, error: 'x' }, false)).toBe(false);
  });

  it('holds a typed field, a changed list and a picked logo', () => {
    expect(wizardDirty({ ...INITIAL, name: 'Open' }, false)).toBe(true);
    expect(wizardDirty({ ...INITIAL, liceNames: ['Lice 1'] }, false)).toBe(true);
    expect(wizardDirty({ ...INITIAL, newVenueHostsWorkshop: true }, false)).toBe(true);
    expect(wizardDirty(INITIAL, true)).toBe(true);
  });
});
