/**
 * Penalty ruleset lineage: how a custom penalty ruleset (or a re-pin's new pin)
 * diverges from the penalty definition it is compared against.
 *
 * Penalties are a SEPARATE ruleset type from scoring — pinned by their own FK,
 * with their own frozen snapshots — so they get their own lamp rather than a
 * fourth scoring bucket, mirroring the content-hash's own {scoring, penalty}
 * pairing. The comparison reuses {@link canonicalizePenaltyDefinition} (the
 * single source of truth for "what materially changes penalty behaviour"): a
 * rename or reorder of entries is not a change, but every card-point /
 * accumulation-scope / forfeit-scope / sanction-ladder edit is — and every one
 * of those re-ranks results, so a `changed` penalties lamp is always
 * ranking-incompatible.
 *
 * Pure + dependency-free (no @myclash/types, no crypto). These projectors are
 * the SAME ones the API's content-hash uses (ruleset-hash.service imports them),
 * so the lamp and the fingerprint can never disagree about what a "change" is.
 */
import {
  canonicalizePenaltyDefinition,
  stableStringify,
  type PenaltyBehaviourInput,
} from './content-hash';
import type { BucketStatus } from './lineage';

type PenaltyRow = Record<string, unknown>;

/** Parent card-point + forfeit-scope columns, shared by both projections. */
function penaltyBaseFields(row: PenaltyRow) {
  return {
    accumulationScope: (row['accumulation_scope'] as string) ?? 'match',
    yellowCardPoints: Number(row['yellow_card_points'] ?? 0),
    redCardPoints: Number(row['red_card_points'] ?? 0),
    blackCardPoints: Number(row['black_card_points'] ?? 0),
    firstBlackCardForfeit: (row['first_black_card_forfeit'] as string) ?? 'match',
    secondBlackCardForfeit: (row['second_black_card_forfeit'] as string) ?? 'tournament',
  };
}

/** Project a FROZEN snapshot row (its `entries` are the already-serialised
 *  camelCase JSONB array) into the penalty behaviour inputs. */
export function projectPenaltyBucketFromSnapshot(row: PenaltyRow): PenaltyBehaviourInput {
  const entries = ((row['entries'] as PenaltyRow[] | undefined) ?? []).map((entry) => ({
    groupNumber: Number(entry['groupNumber']),
    refNumber: String(entry['refNumber']),
    sanctions: (entry['sanctions'] as string[]) ?? [],
  }));
  return { ...penaltyBaseFields(row), entries };
}

/** Project a LIVE parent row with its `penalty_ruleset_entries` embed
 *  (snake_case DB rows) into the penalty behaviour inputs. */
export function projectPenaltyBucketFromLive(row: PenaltyRow): PenaltyBehaviourInput {
  const entries = ((row['penalty_ruleset_entries'] as PenaltyRow[] | undefined) ?? []).map(
    (entry) => ({
      groupNumber: Number(entry['group_number']),
      refNumber: String(entry['ref_number']),
      sanctions: (entry['sanctions'] as string[]) ?? [],
    }),
  );
  return { ...penaltyBaseFields(row), entries };
}

/**
 * Whether a penalty definition diverges from the one it reuses, computed by
 * diffing their canonical forms (never self-declared). Both-absent is unchanged;
 * one-absent is changed. Reuses {@link canonicalizePenaltyDefinition} so the lamp
 * agrees with the content-hash fingerprint by construction.
 */
export function diffPenaltyBucket(
  base: PenaltyBehaviourInput | null,
  fork: PenaltyBehaviourInput | null,
): BucketStatus {
  const b = base ? stableStringify(canonicalizePenaltyDefinition(base)) : null;
  const f = fork ? stableStringify(canonicalizePenaltyDefinition(fork)) : null;
  return b === f ? 'unchanged' : 'changed';
}
