/**
 * Pure shaping for the gear-check desk — no Supabase, no Nest.
 */
import type { RosterEntry } from './roster';

export type GearResult = 'pass' | 'fail' | 'conditional';

/** One `event_gear_checks` row as the gear screen's select returns it. */
export interface GearCheckRow {
  person_id: string;
  weapon_id: string;
  result: string;
  reason: string | null;
  checked_at: string;
}

export interface WeaponStatus {
  weaponId: string;
  weaponName: string;
  /** Null when this weapon has never been checked for this person. */
  result: GearResult | null;
  reason: string | null;
  checkedAt: string | null;
}

export interface GearEntry {
  person: RosterEntry;
  /** One line per weapon this person is entered in. Never empty in practice; see below. */
  weapons: WeaponStatus[];
}

/**
 * The current result per (person, weapon) from an append-only history.
 *
 * 0175 keeps every check so "failed at 09:20, passed at 09:50" is readable, so
 * "current" means newest. The query orders by `checked_at DESC`, which makes
 * the FIRST row seen for a key the winning one — but this does not rely on
 * that: it compares timestamps, so a caller that forgets the ordering gets the
 * right answer rather than a silently stale one.
 */
export function latestCheckPerWeapon(rows: readonly GearCheckRow[]): Map<string, GearCheckRow> {
  const latest = new Map<string, GearCheckRow>();
  for (const row of rows) {
    const key = gearKey(row.person_id, row.weapon_id);
    const held = latest.get(key);
    if (!held || row.checked_at > held.checked_at) latest.set(key, row);
  }
  return latest;
}

export function gearKey(personId: string, weaponId: string): string {
  return `${personId}:${weaponId}`;
}

/**
 * One gear row: the person, then a line per weapon they are entered in.
 *
 * A fighter with NO resolvable weapon still gets a row with an empty list
 * rather than being dropped. `tournaments.weapon` is free text, so a typo that
 * fails to resolve to a catalog entry is a real and silent possibility — and a
 * fighter who vanishes from the gear screen entirely is worse than one the
 * volunteer can see and escalate.
 */
export function buildGearEntry(
  person: RosterEntry,
  weapons: ReadonlyArray<{ id: string; name: string }>,
  latest: Map<string, GearCheckRow>,
): GearEntry {
  return {
    person,
    weapons: weapons.map((weapon) => {
      const row = latest.get(gearKey(person.personId, weapon.id));
      return {
        weaponId: weapon.id,
        weaponName: weapon.name,
        result: row ? toGearResult(row.result) : null,
        reason: row?.reason ?? null,
        checkedAt: row?.checked_at ?? null,
      };
    }),
  };
}

/**
 * Anything unrecognised becomes null — "not checked" — rather than being
 * coerced into a pass. The direction matters: a stored value this build does
 * not know about must read as unchecked, never as cleared to fight.
 */
function toGearResult(value: string): GearResult | null {
  return value === 'pass' || value === 'fail' || value === 'conditional' ? value : null;
}

/** One side of a bout, as the pad shows it. */
export interface MatchGearSide {
  /** Null when this person has never been checked for this bout's weapon. */
  result: GearResult | null;
  reason: string | null;
  checkedAt: string | null;
}

export interface MatchGear {
  /** The bout's weapon, resolved to the catalog. Null when it did not resolve. */
  weaponName: string | null;
  red: MatchGearSide;
  blue: MatchGearSide;
}

/**
 * The gear standing of the two fighters about to fight, for ONE weapon.
 *
 * The gear screen answers "every weapon this person is entered in"; the pad
 * asks a narrower question — the fighter in front of the referee, for the
 * weapon of this bout. A longsword pass says nothing about the rapier they
 * fight with after lunch, so widening this to any-weapon would report a
 * clearance that was never given.
 *
 * A person with no check, or a weapon that never resolved to the catalog,
 * comes back as `result: null` — unchecked. Never as a pass.
 */
export function buildMatchGear(input: {
  weapon: { id: string; name: string } | null;
  redPersonId: string | null;
  bluePersonId: string | null;
  latest: Map<string, GearCheckRow>;
}): MatchGear {
  const side = (personId: string | null): MatchGearSide => {
    const row =
      personId && input.weapon ? input.latest.get(gearKey(personId, input.weapon.id)) : undefined;
    return {
      result: row ? toGearResult(row.result) : null,
      reason: row?.reason ?? null,
      checkedAt: row?.checked_at ?? null,
    };
  };

  return {
    weaponName: input.weapon?.name ?? null,
    red: side(input.redPersonId),
    blue: side(input.bluePersonId),
  };
}
