import { describe, expect, it } from 'vitest';
import { weaponsToSave } from './profile-weapons';

// Ruling 695: the API's strict schema refuses a weapon sent with any key but these four.
describe('the weapons a profile save sends', () => {
  it('sends each ticked weapon by its catalog id, and nothing else', () => {
    const sent = weaponsToSave({
      'w-1': { favorite: true, level: 'advanced', style: '  KDF ' },
      'w-2': { favorite: false, level: null, style: '   ' },
    });
    expect(sent).toEqual([
      { weaponId: 'w-1', favorite: true, level: 'advanced', style: 'KDF' },
      { weaponId: 'w-2', favorite: false, level: null, style: null },
    ]);
  });

  it('sends an empty list when nothing is ticked', () => {
    expect(weaponsToSave({})).toEqual([]);
  });
});
