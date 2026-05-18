import { describe, expect, it, vi } from 'vitest';
import { PersonsController } from './persons.controller';

describe('PersonsController auth', () => {
  it('creates a person using the Supabase-decoded user UUID, not the literal string "unknown"', async () => {
    const createPerson = vi.fn().mockResolvedValue({ id: 'person-1' });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-uuid-123' });

    const controller = new PersonsController({ createPerson } as never, { getAuthUser } as never);

    await controller.create(
      '11111111-1111-4111-8111-111111111111',
      {
        givenName: 'Jean',
        familyName: 'Dupont',
      } as never,
      { cookies: { 'sb-access-token': 'cookie-token' }, headers: {} } as never,
    );

    expect(getAuthUser).toHaveBeenCalledWith('cookie-token');
    expect(createPerson).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ givenName: 'Jean', familyName: 'Dupont' }),
      'user-uuid-123',
    );
  });
});
