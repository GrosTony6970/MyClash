import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ORGANIZER_AI_DRAFT_TYPES = [
  'tournament_config',
  'pool_plan',
  'bracket_plan',
  'schedule_grid',
  'referee_assignments',
] as const;

export type OrganizerAIDraftType = (typeof ORGANIZER_AI_DRAFT_TYPES)[number];

const createOrganizerAIDraftSchema = z
  .object({
    draftType: z.enum(ORGANIZER_AI_DRAFT_TYPES),
    prompt: z.string().min(4),
    tournamentId: z.uuid().optional(),
  })
  .strict();
export class CreateOrganizerAIDraftDto extends createZodDto(createOrganizerAIDraftSchema) {}

const updateOrganizerAIDraftSchema = z
  .object({
    summary: z.string().optional(),
    proposedActions: z.array(z.record(z.string(), z.unknown())).optional(),
    validationState: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(['ready', 'rejected']).optional(),
  })
  .strict();
export class UpdateOrganizerAIDraftDto extends createZodDto(updateOrganizerAIDraftSchema) {}
