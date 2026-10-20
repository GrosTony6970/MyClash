import { BadRequestException } from '@nestjs/common';
import {
  afterblowModeInForce,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_TOURNAMENT_LOCK_CONFIG,
  scoringButtonsOf,
  TOURNAMENT_SIDE_COLORS,
  type TournamentLockConfig,
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
    ? (display['quickPenalties'] as unknown[]).filter(
        (n): n is number => typeof n === 'number' && Number.isFinite(n),
      )
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
