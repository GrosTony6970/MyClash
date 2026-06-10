/**
 * Canonical weapon presets offered by the tournament-creation wizard, and a
 * fuzzy matcher that picks the best preset from a tournament Name.
 *
 * The list is suggestions, not a constraint: the weapon column is free text,
 * so a custom value typed in the combobox is kept as-is. `matchWeapon` only
 * powers the auto-prefill from the Name field.
 */
export const WEAPONS = [
  'Longsword',
  'Sidesword',
  'Sabre',
  'Multiple Weapons',
  'Messer',
  'Sword & Buckler',
  'Rapier',
  'Rapier & Dagger',
  'Sidesword & Buckler',
  'Sidesword & Dagger',
  'Smallsword',
  'Cutting',
] as const;

/** Accent-fold + lowercase + split into alphanumeric word tokens. So `&`,
 * `and`, hyphens, case and diacritics never block a match. */
function tokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

/**
 * Best weapon from `weapons` whose word-tokens ALL appear in `name`
 * (accent/case/punctuation-insensitive, whole-token match so "sabreur" does
 * not match "sabre"). The most specific match wins — most matched tokens,
 * then the longest weapon string. Returns null when nothing matches, so a
 * custom name leaves the field untouched.
 */
export function matchWeapon(name: string, weapons: readonly string[] = WEAPONS): string | null {
  const nameTokens = new Set(tokens(name));
  if (nameTokens.size === 0) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (const weapon of weapons) {
    const weaponTokens = tokens(weapon);
    if (weaponTokens.length === 0) continue;
    if (!weaponTokens.every((tok) => nameTokens.has(tok))) continue;

    // Prefer more tokens (more specific); tie-break on the longer string.
    if (
      weaponTokens.length > bestScore ||
      (weaponTokens.length === bestScore && best !== null && weapon.length > best.length)
    ) {
      best = weapon;
      bestScore = weaponTokens.length;
    }
  }
  return best;
}
