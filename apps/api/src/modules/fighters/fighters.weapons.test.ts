/**
 * Ruling 695: only super admins add catalog weapons. A fighter's profile save names weapons by
 * their catalog id; an id that is not in the catalog, or one given twice, refuses the whole save
 * before any part of the profile is written, and no save ever writes the catalog.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { FightersService } from './fighters.service';

const PAUL = '6a1f0c3e-2b4d-4e8f-9a7b-5c6d7e8f9a01';
const LONGSWORD = '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8';
const RAPIER = '2c3d4e5f-6071-4b82-9ca3-b4c5d6e7f809';
const GONE = '3d4e5f60-7182-4c93-8db4-c5d6e7f8091a';

function profileSave() {
  const db = mockSupabase({
    global_persons: { rows: [{ id: PAUL, claimed_by_user_id: 'user-paul' }] },
    // A hidden weapon is still on the list a fighter picks from (ruling 702).
    weapon_catalog: {
      rows: [
        { id: LONGSWORD, name: 'Longsword', active: true },
        { id: RAPIER, name: 'Rapier', active: false },
      ],
    },
    fighter_weapons: { rows: [] },
  });
  const service = new FightersService(db as never, {} as never);
  const seams = service as unknown as {
    update: (id: string, dto: unknown) => Promise<unknown>;
    getMyProfile: (userId: string) => Promise<unknown>;
  };
  // The rest of the profile: written by `update`, which a refused save must never reach.
  const update = vi.fn(async () => ({}));
  seams.update = update;
  seams.getMyProfile = async () => ({ id: PAUL });
  const save = (weaponIds: string[]) =>
    service.updateMyProfile('user-paul', {
      fighterId: PAUL,
      bio: 'Longsword since Lyon',
      weapons: weaponIds.map((weaponId, i) => ({ weaponId, favorite: i === 0 })),
    } as never);
  return { db, save, update };
}

describe("a fighter's weapons come from the catalog (ruling 695)", () => {
  it('saves catalog weapons, hidden ones included, in the order given', async () => {
    const { db, save } = profileSave();
    await save([RAPIER, LONGSWORD]);

    expect(selectsFor(db.from, 'weapon_catalog')).toEqual(['id']);
    expect(filtersFor(db.from, 'weapon_catalog', 'in')).toEqual([['id', [RAPIER, LONGSWORD]]]);
    const writes = writesTo(db, 'fighter_weapons');
    expect(writes.map((w) => w.op)).toEqual(['delete', 'insert']);
    expect(writes[1]?.row).toEqual([
      expect.objectContaining({ weapon_id: RAPIER, favorite: true, sort_order: 0 }),
      expect.objectContaining({ weapon_id: LONGSWORD, favorite: false, sort_order: 1 }),
    ]);
  });

  it('refuses an id that is not in the catalog before it writes anything', async () => {
    const { db, save, update } = profileSave();
    await expect(save([LONGSWORD, GONE])).rejects.toThrow(
      new BadRequestException('Pick a weapon from the list'),
    );
    expect(update).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('refuses the same weapon twice before it writes anything', async () => {
    const { db, save, update } = profileSave();
    await expect(save([LONGSWORD, LONGSWORD])).rejects.toThrow(
      new BadRequestException('Pick each weapon once'),
    );
    expect(update).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('clears the weapons on an empty list without asking the catalog', async () => {
    const { db, save } = profileSave();
    await save([]);
    expect(selectsFor(db.from, 'weapon_catalog')).toEqual([]);
    expect(writesTo(db, 'fighter_weapons').map((w) => w.op)).toEqual(['delete']);
  });

  it('never writes the catalog', async () => {
    const { db, save } = profileSave();
    await save([LONGSWORD]);
    await save([GONE]).catch(() => undefined);
    expect(writesTo(db, 'weapon_catalog')).toEqual([]);
  });
});
