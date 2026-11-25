import { describe, expect, it } from 'vitest';
import { createProtestSchema } from './protests.dto';

const base = {
  clientUuid: 'a0000000-0000-4000-8000-000000000001',
  sequence: 1,
  occurredAt: '2026-11-25T10:00:00Z',
};
const REGISTRATION = 'c0000000-0000-4000-8000-00000000000a';
const TEAM = 'd0000000-0000-4000-8000-00000000000a';

describe('createProtestSchema: a protest names exactly one side', () => {
  it('takes a Registration, or a team', () => {
    expect(createProtestSchema.safeParse({ ...base, registrationId: REGISTRATION }).success).toBe(
      true,
    );
    expect(createProtestSchema.safeParse({ ...base, teamId: TEAM }).success).toBe(true);
  });

  it('refuses both, and neither', () => {
    expect(
      createProtestSchema.safeParse({ ...base, registrationId: REGISTRATION, teamId: TEAM })
        .success,
    ).toBe(false);
    expect(createProtestSchema.safeParse(base).success).toBe(false);
  });
});
