import { BadRequestException } from '@nestjs/common';
import {
  doubleElimBracket,
  singleElimBracket,
  type DoubleElimBracket,
  type SingleElimBracket,
} from '@myclash/rules/scheduling';
import { doubleElimOptionsFromDto, type DoubleElimOptionInput } from './double-elim-config';

/** What the builder reads of a Generate Bracket request: the type, the size, the podium. */
export interface BracketShapeInput extends DoubleElimOptionInput {
  phaseType?: 'single_elim' | 'double_elim';
  bracketSize?: number;
}

export type BracketShape =
  | { phaseType: 'double_elim'; bracket: DoubleElimBracket }
  | { phaseType: 'single_elim'; bracket: SingleElimBracket };

/**
 * The bracket of `qualifyCount` fighters that Generate Bracket builds, or a 400 in the builder's
 * own words ("bracketSize (8) must be ≥ fighterCount (16)"). Generate Bracket builds with it,
 * and Claude's bracket draft asks it before it saves a draft that Apply would refuse. Any type
 * but `double_elim` is a single-elimination bracket, Generate Bracket's default.
 */
export function buildBracketShape(qualifyCount: number, dto: BracketShapeInput): BracketShape {
  const bracketOptions = dto.bracketSize !== undefined ? { bracketSize: dto.bracketSize } : {};
  try {
    if (dto.phaseType === 'double_elim') {
      // The podium options MUST reach the generator, not just config_json:
      // they are what emit (or omit) the reset and grand-final slots and what
      // size the losers bracket. Stamping a flag without passing it here left
      // the option enabled everywhere in the UI while the slot it controls
      // was never created.
      const bracket = doubleElimBracket(qualifyCount, {
        ...bracketOptions,
        ...doubleElimOptionsFromDto(dto),
      });
      return { phaseType: 'double_elim', bracket };
    }
    return { phaseType: 'single_elim', bracket: singleElimBracket(qualifyCount, bracketOptions) };
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : 'Invalid bracket');
  }
}
