import { describe, expect, it } from 'vitest';
import { createPersonSchema } from './persons.dto';

/**
 * Locks the "newClubName" invariants for the add-participant flow:
 *   - optional, accepts a non-empty trimmed string;
 *   - mutually exclusive with `clubId` (both → rejected);
 *   - whitespace-only values are rejected.
 */
describe('createPersonSchema — newClubName', () => {
  const base = { givenName: 'Jean', familyName: 'Dupont' };

  it('accepts a valid newClubName when clubId is absent', () => {
    expect(createPersonSchema.safeParse({ ...base, newClubName: 'Lyon AMHE' }).success).toBe(true);
  });

  it('accepts neither newClubName nor clubId', () => {
    expect(createPersonSchema.safeParse(base).success).toBe(true);
  });

  it('rejects sending both clubId and newClubName', () => {
    const r = createPersonSchema.safeParse({
      ...base,
      clubId: '00000000-0000-4000-8000-000000000001',
      newClubName: 'Lyon AMHE',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a whitespace-only newClubName', () => {
    expect(createPersonSchema.safeParse({ ...base, newClubName: '   ' }).success).toBe(false);
  });
});
