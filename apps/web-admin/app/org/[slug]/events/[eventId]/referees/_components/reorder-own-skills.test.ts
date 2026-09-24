import { describe, expect, it } from 'vitest';
import { reorderOwnSkills } from './reorder-own-skills';

// Built-ins first, as the catalogue lists them; only the custom skills move
// (operator ruling 104b: the server refuses a list holding a built-in).
const SKILLS = [
  { id: 'arbitre_declarant', isSystem: true },
  { id: 'arbitre_table', isSystem: true },
  { id: 'custom-1', isSystem: false },
  { id: 'custom-2', isSystem: false },
  { id: 'custom-3', isSystem: false },
];

describe('reorderOwnSkills', () => {
  it("sends this Event's custom skills only, in their new order", () => {
    expect(reorderOwnSkills(SKILLS, 'custom-3', 'custom-1')).toEqual([
      'custom-3',
      'custom-1',
      'custom-2',
    ]);
  });

  it.each([
    ['a built-in dragged onto a custom skill', 'arbitre_table', 'custom-2'],
    ['a custom skill dropped on a built-in', 'custom-2', 'arbitre_declarant'],
    ['a skill dropped on itself', 'custom-2', 'custom-2'],
  ])('sends nothing for %s', (_label, dragId, targetId) => {
    expect(reorderOwnSkills(SKILLS, dragId, targetId)).toBeNull();
  });
});
