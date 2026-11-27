import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * A team of a team Tournament (0281 `teams`, 0283 `logo_url`). The bounds are the table's checks:
 * a name of 1 to 120 characters once trimmed (`teams_name_filled`), a size of 1 to 10
 * (`teams_size_range`). The colour is a token, as a Tournament's (`events.dto.ts`). In slice 1b a
 * team has no named members (ruling 973): its seats are numbered by its size.
 */
const name = z.string().trim().min(1).max(120);
const size = z.number().int().min(1).max(10);
const seed = z.number().int().min(1).nullish();

const createTeamSchema = z
  .object({
    name,
    /** The Tournament's `team_default_size` when omitted. */
    size: size.optional(),
    color: z.string().max(32).nullish(),
    seed,
  })
  .strict();
export class CreateTeamDto extends createZodDto(createTeamSchema) {}

const updateTeamSchema = z
  .object({
    name: name.optional(),
    size: size.optional(),
    /** Null clears it. */
    color: z.string().max(32).nullish(),
    /** Null clears it. */
    seed,
    /** Null removes the logo; a new one comes through the upload route only. */
    logoUrl: z.null().optional(),
  })
  .strict();
export class UpdateTeamDto extends createZodDto(updateTeamSchema) {}
