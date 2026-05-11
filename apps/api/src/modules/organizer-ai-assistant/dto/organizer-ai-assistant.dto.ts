import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export const ORGANIZER_AI_DRAFT_TYPES = [
  'tournament_config',
  'pool_plan',
  'bracket_plan',
  'schedule_grid',
  'referee_assignments',
] as const;

export type OrganizerAIDraftType = (typeof ORGANIZER_AI_DRAFT_TYPES)[number];

export class CreateOrganizerAIDraftDto {
  @IsIn(ORGANIZER_AI_DRAFT_TYPES)
  draftType!: OrganizerAIDraftType;

  @IsString()
  @MinLength(4)
  prompt!: string;

  @IsOptional()
  @IsUUID()
  tournamentId?: string;
}

export class UpdateOrganizerAIDraftDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  proposedActions?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsObject()
  validationState?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['ready', 'rejected'])
  status?: 'ready' | 'rejected';
}
