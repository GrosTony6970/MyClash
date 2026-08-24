/**
 * Translation between the double-elim wire options, the generator, and
 * `phases.config_json`.
 *
 * Kept out of PhasesService because these are pure mappings with rules of
 * their own — notably which config changes can be applied to an ALREADY
 * GENERATED bracket. `editBracketConfig` writes config only; it never rebuilds
 * bracket_slots. So any option that changes the slot set (the podium model, the
 * repechage cutoff) would leave a bracket whose stored shape contradicts its
 * rows — the exact silent-corruption class this format has already produced
 * once. Those changes are refused with a pointer to regenerate instead.
 *
 * `grandFinalReset` is the one safe edit: the reset slot carries no match (it
 * is deliberately excluded from `createInitialBracketMatches`), so it can be
 * added or removed in place.
 */

import type { DoubleElimBracket, DoubleElimOptions } from '@myclash/rules/scheduling';

/** The subset of the generate/edit DTOs this module reads. */
export interface DoubleElimOptionInput {
  grandFinalReset?: boolean;
  secondChanceTarget?: 'gold' | 'bronze';
  bronzeMatch?: boolean;
  repechageEntrySize?: number | null;
}

/**
 * Build generator options from a DTO.
 *
 * `bronzeMatch` is forwarded ONLY in bronze mode: the generator rejects it in
 * gold mode (as does the DTO), so passing an explicit `undefined` through
 * would be indistinguishable from the operator having ticked it.
 */
export function doubleElimOptionsFromDto(
  dto: DoubleElimOptionInput,
  bracketSize?: number,
): DoubleElimOptions {
  const secondChanceTarget = dto.secondChanceTarget ?? 'gold';
  return {
    ...(bracketSize !== undefined ? { bracketSize } : {}),
    secondChanceTarget,
    ...(secondChanceTarget === 'bronze'
      ? { bronzeMatch: dto.bronzeMatch ?? true }
      : { grandFinalReset: dto.grandFinalReset === true }),
    repechageEntrySize: dto.repechageEntrySize ?? null,
  };
}

/**
 * The `config_json` payload for a generated double-elim phase. Everything the
 * ranking, round-code, export and UI layers need is stamped here so no reader
 * has to re-derive it from the slot rows.
 */
export function doubleElimConfigJson(
  bracket: DoubleElimBracket,
  seedingStrategy: string,
): Record<string, unknown> {
  return {
    bracketSize: bracket.bracketSize,
    mainBracketSize: bracket.mainBracketSize,
    fighterCount: bracket.fighterCount,
    // Always 0 — a double-elim bracket is trimmed by a round-0 play-in rather
    // than padded with byes, because a bye has no loser and the losers bracket
    // feeds off `loser of WBR1Px`.
    byeCount: bracket.byeCount,
    byeSeedCount: bracket.byeSeedCount,
    playInMatchCount: bracket.playInMatchCount,
    hasPlayInRound: bracket.hasPlayInRound,
    wbRounds: bracket.wbRounds,
    lbRounds: bracket.lbRounds,
    autoAdvance: true,
    grandFinalReset: bracket.grandFinalReset,
    secondChanceTarget: bracket.secondChanceTarget,
    bronzeMatch: bracket.bronzeMatch,
    repechageEntrySize: bracket.repechageEntrySize,
    // Derived once here so every reader (ranking, UI, exports) agrees on which
    // winners-bracket rounds eliminate outright.
    repechageEntryRound: bracket.repechageEntryRound,
    seedingStrategy,
  };
}

/** Options whose value changes the SET of bracket slots, not just their meaning. */
const STRUCTURAL_FIELDS = ['secondChanceTarget', 'bronzeMatch', 'repechageEntrySize'] as const;

/**
 * Which requested edits would reshape an existing bracket. A field that is
 * being set to the value it already has is not a change.
 */
export function structuralConfigChanges(
  dto: DoubleElimOptionInput,
  config: Record<string, unknown>,
): string[] {
  const current: Record<(typeof STRUCTURAL_FIELDS)[number], unknown> = {
    secondChanceTarget: config['secondChanceTarget'] ?? 'gold',
    bronzeMatch: config['bronzeMatch'] ?? false,
    repechageEntrySize: config['repechageEntrySize'] ?? null,
  };
  return STRUCTURAL_FIELDS.filter((field) => {
    const requested = dto[field];
    if (requested === undefined) return false;
    return (requested ?? null) !== (current[field] ?? null);
  });
}
