import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_SCORING_CONFIG,
  TOURNAMENT_SIDE_COLORS,
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

function ensureButtonArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

export function normalizeTournamentScoringConfig(input: unknown): TournamentScoringConfig {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const buttons =
    raw['buttons'] && typeof raw['buttons'] === 'object'
      ? (raw['buttons'] as Record<string, unknown>)
      : {};
  const display =
    raw['display'] && typeof raw['display'] === 'object'
      ? (raw['display'] as Record<string, unknown>)
      : {};
  const sideColors =
    display['sideColors'] && typeof display['sideColors'] === 'object'
      ? (display['sideColors'] as Record<string, unknown>)
      : {};

  return {
    afterblowMode: raw['afterblowMode'] === 'deductive' ? 'deductive' : 'full',
    buttons: {
      clean: ensureButtonArray(buttons['clean'], DEFAULT_SCORING_CONFIG.buttons.clean),
      afterblow: ensureButtonArray(buttons['afterblow'], DEFAULT_SCORING_CONFIG.buttons.afterblow),
    },
    display: {
      sideColors: {
        red: parseSideColor(sideColors['red'], DEFAULT_SCORING_CONFIG.display.sideColors.red),
        blue: parseSideColor(sideColors['blue'], DEFAULT_SCORING_CONFIG.display.sideColors.blue),
      },
    },
  };
}

export type TournamentRulesetConfig = TFv1Config | GenericPointsCapConfig;

export function validateTournamentRulesetConfig(
  rulesetCode: string,
  input: unknown,
): TournamentRulesetConfig {
  try {
    if (rulesetCode === 'Generic_PointsCap') {
      return GenericPointsCapConfigSchema.parse(input ?? {});
    }
    return TFv1ConfigSchema.parse(input ?? {});
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
