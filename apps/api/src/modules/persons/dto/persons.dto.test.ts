import { describe, expect, it } from 'vitest';
import { createPersonSchema, updatePersonSchema } from './persons.dto';

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

/**
 * The add/edit forms send `null` (not `undefined`) to clear an empty optional
 * field — e.g. `email: addForm.email.trim() || null`. The old class-validator
 * `@IsOptional()` accepted null; the Zod migration must keep accepting it, or
 * every save with a blank email/club/HEMA-id 400s with "Validation failed".
 */
describe('person schemas accept null for FE-clearable optional fields', () => {
  const base = { givenName: 'Jean', familyName: 'Dupont' };

  it('updatePersonSchema accepts null email / clubId / hemaRatingsId (clear-to-empty)', () => {
    const r = updatePersonSchema.safeParse({
      givenName: 'Clément',
      familyName: 'Calliau',
      email: null,
      clubId: null,
      hemaRatingsId: null,
    });
    expect(r.success).toBe(true);
  });

  it('updatePersonSchema still accepts real values and still rejects an invalid email', () => {
    expect(
      updatePersonSchema.safeParse({
        email: 'a@b.com',
        clubId: '00000000-0000-4000-8000-000000000001',
        hemaRatingsId: 'hr-123',
      }).success,
    ).toBe(true);
    expect(updatePersonSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('createPersonSchema accepts the add form sending null for the empty optionals', () => {
    // selectedClubId / newClubName / globalPersonId / email all sent as null.
    const r = createPersonSchema.safeParse({
      ...base,
      email: null,
      clubId: null,
      newClubName: null,
      hemaRatingsId: null,
      globalPersonId: null,
    });
    expect(r.success).toBe(true);
  });

  it('createPersonSchema accepts a selected club (clubId set, newClubName null)', () => {
    // Picking an existing club sends `newClubName: null` — must NOT trip the
    // clubId/newClubName mutual-exclusivity refine.
    const r = createPersonSchema.safeParse({
      ...base,
      clubId: '00000000-0000-4000-8000-000000000001',
      newClubName: null,
    });
    expect(r.success).toBe(true);
  });

  it('createPersonSchema still rejects clubId together with a real newClubName', () => {
    const r = createPersonSchema.safeParse({
      ...base,
      clubId: '00000000-0000-4000-8000-000000000001',
      newClubName: 'Lyon AMHE',
    });
    expect(r.success).toBe(false);
  });
});
