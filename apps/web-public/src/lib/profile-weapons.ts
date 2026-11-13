/**
 * The weapons a profile save sends. Each is a catalog id the fighter ticked: only super admins add
 * catalog weapons, and the API refuses any other key (ruling 695), so a name never goes with it.
 */

export type WeaponLevel = 'just_for_fun' | 'beginner' | 'intermediate' | 'advanced';

export interface TickedWeapon {
  favorite: boolean;
  level: WeaponLevel | null;
  style: string;
}

export interface WeaponToSave {
  weaponId: string;
  favorite: boolean;
  level: WeaponLevel | null;
  style: string | null;
}

/** The ticked weapons, keyed by catalog id, in the order they were ticked. */
export function weaponsToSave(ticked: Record<string, TickedWeapon>): WeaponToSave[] {
  return Object.entries(ticked).map(([weaponId, weapon]) => ({
    weaponId,
    favorite: weapon.favorite,
    level: weapon.level,
    style: weapon.style.trim() || null,
  }));
}
