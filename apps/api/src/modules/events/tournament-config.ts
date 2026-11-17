import { BadRequestException } from '@nestjs/common';
import {
  afterblowModeInForce,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_TOURNAMENT_LOCK_CONFIG,
  scoringButtonsOf,
  TOURNAMENT_SIDE_COLORS,
  type TournamentLockConfig,
  type TournamentProtestRules,
  type TournamentScoringConfig,
  type TournamentSideColor,
} from '@myclash/types';
import {
  GenericPointsCapConfigSchema,
  TFv1ConfigSchema,
  type GenericPointsCapConfig,
  type TFv1Config,
} from '@myclash/rulesets';

const sideColorSet = new Set<string>(TOURNAMENT_SIDE_COLORS);

function parseSideColor(value: unknown, fallback: TournamentSideColor): TournamentSideColor {
  if (typeof value === 'undefined' || value === null) return fallback;
  if (typeof value === 'string' && sideColorSet.has(value)) {
    return value as TournamentSideColor;
  }
  throw new BadRequestException(`Unsupported fighter side color: ${String(value)}`);
}

/** The longest penalty ref an entry may have: the protest offer and the quick-pick pins take no more. */
const MAX_PENALTY_REF_LENGTH = 20;

/**
 * `display.protests` as stored: a whole limit of 0 or more or null, and a penalty ref that is
 * non-empty text of 20 characters at most, or null. A ref is text: refs like `R7a` exist.
 */
function parseProtestRules(value: unknown): TournamentProtestRules {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!raw) throw new BadRequestException(`Unsupported protest rules: ${String(value)}`);
  const limit = raw['limit'] ?? null;
  if (limit !== null && !(typeof limit === 'number' && Number.isInteger(limit) && limit >= 0)) {
    throw new BadRequestException(`Unsupported protest limit: ${String(limit)}`);
  }
  const ref = raw['offerPenaltyRef'] ?? null;
  const refFits = typeof ref === 'string' && ref.length > 0 && ref.length <= MAX_PENALTY_REF_LENGTH;
  if (ref !== null && !refFits) {
    throw new BadRequestException(`Unsupported protest penalty ref: ${String(ref)}`);
  }
  return { limit, offerPenaltyRef: ref as string | null };
}

/**
 * One pinned ref, as text, or nothing. A ref is TEXT (migration 0071); a number is a Tournament
 * saved before the pins were text, so it reads as its text. Anything else is no ref.
 */
function quickPenaltyRef(value: unknown): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [String(value)] : [];
  if (typeof value !== 'string') return [];
  const ref = value.trim();
  // No entry has a longer ref (penalties.service.ts replaceEntries). Dropped, not refused: this runs on read too.
  return ref === '' || ref.length > MAX_PENALTY_REF_LENGTH ? [] : [ref];
}

export function normalizeTournamentScoringConfig(input: unknown): TournamentScoringConfig {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const display =
    raw['display'] && typeof raw['display'] === 'object'
      ? (raw['display'] as Record<string, unknown>)
      : {};
  const sideColors =
    display['sideColors'] && typeof display['sideColors'] === 'object'
      ? (display['sideColors'] as Record<string, unknown>)
      : {};
  const quickPenalties = Array.isArray(display['quickPenalties'])
    ? [...new Set((display['quickPenalties'] as unknown[]).flatMap(quickPenaltyRef))]
    : [];

  return {
    afterblowMode: afterblowModeInForce(raw),
    buttons: scoringButtonsOf(raw['buttons']),
    display: {
      sideColors: {
        red: parseSideColor(sideColors['red'], DEFAULT_SCORING_CONFIG.display.sideColors.red),
        blue: parseSideColor(sideColors['blue'], DEFAULT_SCORING_CONFIG.display.sideColors.blue),
      },
      quickPenalties,
      // Absent on a Tournament saved before the limit: it stays absent (no limit).
      ...(display['protests'] === undefined
        ? {}
        : { protests: parseProtestRules(display['protests']) }),
    },
  };
}

export function normalizeTournamentLockConfig(input: unknown): TournamentLockConfig {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const delay =
    typeof raw['autoLockDelayMinutes'] === 'number'
      ? Math.max(0, Math.floor(raw['autoLockDelayMinutes']))
      : DEFAULT_TOURNAMENT_LOCK_CONFIG.autoLockDelayMinutes;
  return {
    autoLockEnabled:
      typeof raw['autoLockEnabled'] === 'boolean'
        ? raw['autoLockEnabled']
        : DEFAULT_TOURNAMENT_LOCK_CONFIG.autoLockEnabled,
    autoLockDelayMinutes: delay,
    autoLockCompletedPools:
      typeof raw['autoLockCompletedPools'] === 'boolean'
        ? raw['autoLockCompletedPools']
        : DEFAULT_TOURNAMENT_LOCK_CONFIG.autoLockCompletedPools,
    autoLockCompletedBrackets:
      typeof raw['autoLockCompletedBrackets'] === 'boolean'
        ? raw['autoLockCompletedBrackets']
        : DEFAULT_TOURNAMENT_LOCK_CONFIG.autoLockCompletedBrackets,
  };
}

export type TournamentRulesetConfig = TFv1Config | GenericPointsCapConfig;

export function validateTournamentRulesetConfig(
  rulesetCode: string,
  input: unknown,
): TournamentRulesetConfig {
  return inEngineWords(() =>
    rulesetCode === 'Generic_PointsCap'
      ? GenericPointsCapConfigSchema.parse(input ?? {})
      : TFv1ConfigSchema.parse(input ?? {}),
  );
}

/**
 * `read`, with a refusal of the engine's schemas answered as a 400 in the engine's own words. The
 * ONE translation, for the settings parse and every engine function a settings write calls (the
 * match format normalizer throws a raw ZodError, which would be a 500).
 */
export function inEngineWords<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'issues' in error &&
      Array.isArray((error as { issues?: unknown }).issues)
    ) {
      throw new BadRequestException(
        (error as { issues: Array<{ message?: string }> }).issues
          .map((issue) => issue.message ?? 'Invalid ruleset configuration')
          .join('; '),
      );
    }
    throw error;
  }
}
