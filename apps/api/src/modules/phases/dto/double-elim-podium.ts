import { z } from 'zod';

/**
 * The double-elimination podium options, shared by `GenerateBracketDto` and
 * `EditBracketConfigDto` so the two endpoints validate them identically.
 *
 * Inapplicable options are REJECTED rather than silently dropped. An organiser
 * who ticks "grand final reset" in bronze mode and gets a bracket with no
 * grand final has been misled, not accommodated — and this codebase has
 * already paid for one silently-ignored double-elim flag (`grandFinalReset`
 * was stamped into config_json but never reached the generator, so the reset
 * slot it controlled was never created at all).
 */

/** Cutoffs the UI offers. `null` = everyone gets a second chance. */
export const REPECHAGE_ENTRY_SIZES = [8, 16, 32] as const;

export const doubleElimPodiumFields = {
  /**
   * Can the losers-bracket winner take gold ('gold', the classical esports
   * model), or does the winners-bracket final decide gold/silver on its own
   * while the repechage plays for bronze ('bronze', common in HEMA/fencing)?
   */
  secondChanceTarget: z.enum(['gold', 'bronze']).optional(),
  /**
   * Bronze mode only: play a bronze match, or stop the repechage one round
   * early and separate the two survivors by pool score. Not applicable in gold
   * mode, where third place is already the losers-bracket final's loser.
   */
  bronzeMatch: z.boolean().optional(),
  /**
   * Second-chance cutoff by winners-bracket depth. `null` (the default) gives
   * everyone who loses in the winners bracket a second chance; a number means
   * only fighters knocked out at that depth or later get one.
   */
  repechageEntrySize: z
    .union([z.literal(8), z.literal(16), z.literal(32)])
    .nullable()
    .optional(),
};

interface DoubleElimPodiumInput {
  phaseType?: 'single_elim' | 'double_elim';
  grandFinalReset?: boolean;
  secondChanceTarget?: 'gold' | 'bronze';
  bronzeMatch?: boolean;
  repechageEntrySize?: number | null;
}

function reject(ctx: z.RefinementCtx, path: string, message: string): void {
  ctx.addIssue({ code: 'custom', path: [path], message });
}

/**
 * Cross-field rules. Applied by both DTOs via `.superRefine`, because a
 * per-field schema cannot see the mode the field depends on.
 */
export function refineDoubleElimPodium(value: DoubleElimPodiumInput, ctx: z.RefinementCtx): void {
  const target = value.secondChanceTarget ?? 'gold';

  if (target === 'gold' && value.bronzeMatch !== undefined) {
    reject(
      ctx,
      'bronzeMatch',
      'bronzeMatch only applies when secondChanceTarget is "bronze" — in gold mode third ' +
        'place is already decided by the losers-bracket final',
    );
  }

  if (target === 'bronze' && value.grandFinalReset === true) {
    reject(
      ctx,
      'grandFinalReset',
      'grandFinalReset only applies when secondChanceTarget is "gold" — in bronze mode the ' +
        'winners-bracket final decides gold and silver, so there is no grand final',
    );
  }

  // A single-elim bracket has no losers bracket to configure. `grandFinalReset`
  // is deliberately NOT checked here: it predates these options and callers
  // have always been allowed to send it harmlessly, so tightening it would be
  // a breaking change for no benefit.
  if (value.phaseType === 'single_elim') {
    for (const field of ['secondChanceTarget', 'bronzeMatch', 'repechageEntrySize'] as const) {
      if (value[field] !== undefined) {
        reject(ctx, field, `${field} only applies to double-elimination brackets`);
      }
    }
  }
}
