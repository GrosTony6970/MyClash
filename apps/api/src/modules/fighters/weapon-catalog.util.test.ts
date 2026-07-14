import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { resolveCatalogWeapon, type CatalogWeaponClient } from './weapon-catalog.util';

/**
 * Build a stub Supabase client whose `weapon_catalog` select/eq resolves to the
 * given active rows (mirroring `.from().select('name').eq('active', true)`).
 */
function clientWith(
  rows: Array<{ name: string }> | null,
  error: { message: string } | null = null,
): CatalogWeaponClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error }),
      }),
    }),
  };
}

describe('resolveCatalogWeapon', () => {
  it('returns the canonical catalog name for an exact match', async () => {
    const client = clientWith([{ name: 'Longsword' }, { name: 'Sabre' }]);
    await expect(resolveCatalogWeapon(client, 'Longsword')).resolves.toBe('Longsword');
  });

  it('matches case-insensitively and trims, returning canonical casing', async () => {
    const client = clientWith([{ name: 'Sword & Buckler' }]);
    await expect(resolveCatalogWeapon(client, '  sword & buckler ')).resolves.toBe(
      'Sword & Buckler',
    );
  });

  it('throws BadRequestException when the weapon is not in the active catalog', async () => {
    const client = clientWith([{ name: 'Longsword' }]);
    await expect(resolveCatalogWeapon(client, 'Katana')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a weapon that is absent because it is inactive (empty active set)', async () => {
    // eq('active', true) would filter a deactivated weapon out entirely.
    const client = clientWith([]);
    await expect(resolveCatalogWeapon(client, 'Ringen')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('surfaces a DB error as BadRequestException', async () => {
    const client = clientWith(null, { message: 'boom' });
    await expect(resolveCatalogWeapon(client, 'Longsword')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
