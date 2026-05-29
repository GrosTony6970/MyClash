import { describe, it, expect } from 'vitest';
import { countQualifiedBySkill } from './count-qualified-by-skill';

describe('countQualifiedBySkill', () => {
  it('counts each non-null rating as one qualification per skill', () => {
    const result = countQualifiedBySkill([
      {
        qualifications: [
          { skillId: 'arbitre_declarant', rating: 4 },
          { skillId: 'arbitre_assesseur', rating: 3 },
        ],
      },
    ]);

    expect(result.get('arbitre_declarant')).toBe(1);
    expect(result.get('arbitre_assesseur')).toBe(1);
  });

  it("ignores entries with a null rating (operator hasn't rated yet)", () => {
    const result = countQualifiedBySkill([
      { qualifications: [{ skillId: 'arbitre_declarant', rating: 4 }] },
      { qualifications: [{ skillId: 'arbitre_declarant', rating: null }] },
      { qualifications: [{ skillId: 'arbitre_declarant', rating: null }] },
    ]);

    expect(result.get('arbitre_declarant')).toBe(1);
  });

  it('returns an empty map for an empty roster', () => {
    const result = countQualifiedBySkill([]);
    expect(result.size).toBe(0);
  });
});
