import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { SuggestConfig, TournamentLengths } from '@myclash/types';

const HH_MM = /^\d{2}:\d{2}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * A bout length on the sheet: whole minutes, above zero. Zero would hide a clash
 * rather than show one (a zero-length window at 10:00 does not overlap a bout
 * that starts at 10:00), and `matchWindowMs` refuses it outright.
 */
export const lengthMinutes = z.number().int().positive();

/** One Tournament's own lengths. A blank one reads the Event's number. */
const tournamentLengthsSchema = z
  .object({
    tournamentId: z.uuid(),
    poolMatchDurationMinutes: lengthMinutes.optional(),
    swissMatchDurationMinutes: lengthMinutes.optional(),
    eliminationMatchDurationMinutes: lengthMinutes.optional(),
    finalsMatchDurationMinutes: lengthMinutes.optional(),
  })
  .strict();

/**
 * The planner's sheet (ADR-018): ADR-021's fields in three groups, and the one
 * owner of their defaults.
 *
 * Suggest takes it as its body and `PUT …/programme/config` stores it, so the two
 * cannot disagree on a field. A missing row, or a stored sheet missing a field,
 * reads as these defaults, because `getConfig` parses what it loads.
 *
 * Zod 4's `.default()` does NOT validate the value it returns, so a default of 0
 * on a positive length would parse. `programme.dto.test.ts` parses the defaults
 * back through the schema to catch that.
 */
const programmeConfigFields = {
  // Day
  dayStartTime: z.string().regex(HH_MM).default('08:00'),
  dayEndTime: z.string().regex(HH_MM).default('19:00'),
  middayBreakStart: z.string().regex(HH_MM).default('12:00'),
  middayBreakMinutes: z.number().int().min(0).default(60),
  // Bouts
  poolMatchDurationMinutes: lengthMinutes.default(5),
  // No default, on purpose: absent means a Swiss bout takes the pool length.
  swissMatchDurationMinutes: lengthMinutes.optional(),
  eliminationMatchDurationMinutes: lengthMinutes.default(8),
  finalsMatchDurationMinutes: lengthMinutes.default(10),
  matchGapSeconds: z.number().int().min(0).default(10),
  minRestMinutes: z.number().int().min(0).default(10),
  tournaments: z
    .array(tournamentLengthsSchema)
    .refine((rows) => new Set(rows.map((r) => r.tournamentId)).size === rows.length, {
      message: 'A Tournament has one row of lengths, not several',
    })
    .default([]),
  // Blocks
  breakBetweenSessionsMinutes: z.number().int().min(0).default(10),
  refereeMeetingDurationMinutes: z.number().int().min(0).default(30),
  arrivalAndGearCheckMinutes: z.number().int().min(0).default(90),
};

export const programmeConfigSchema = z.object(programmeConfigFields).strict();

/**
 * The sheet as it is read back from the database. A field the schema no longer
 * has is dropped rather than refused, so a sheet stored under an older field
 * list (a restored archive, say) still opens and the next save writes it clean.
 * Refusing it would leave the planner unable to load the sheet, and so unable
 * to save the one that fixes it. A value out of range is still refused.
 */
export const storedProgrammeConfigSchema = z.object(programmeConfigFields);

export const PROGRAMME_CONFIG_DEFAULTS: SuggestConfig = programmeConfigSchema.parse({});

/** Suggest's body and the stored sheet. One schema, so one field list. */
export class ProgrammeConfigDto extends createZodDto(programmeConfigSchema) {}

/**
 * The schema and the shared type name the same fields, in both directions.
 * A `never` ASSIGNMENT would pin nothing, because `never` is assignable to every
 * type (see `packages/types/src/league-ranking.ts`). Constraining a type
 * PARAMETER is what fails to compile.
 */
type AssertNever<T extends never> = T;
type SheetField = keyof z.output<typeof programmeConfigSchema>;
type TournamentLengthsField = keyof z.output<typeof tournamentLengthsSchema>;
export type ProgrammeConfigMatchesSuggestConfig = [
  AssertNever<Exclude<SheetField, keyof SuggestConfig>>,
  AssertNever<Exclude<keyof SuggestConfig, SheetField>>,
  AssertNever<Exclude<TournamentLengthsField, keyof TournamentLengths>>,
  AssertNever<Exclude<keyof TournamentLengths, TournamentLengthsField>>,
];

const programmeBlockSchema = z
  .object({
    id: z.string().min(1),
    dayIndex: z.number().int().min(0),
    sortOrder: z.number().int().min(0),
    blockType: z.enum(['admin', 'competition', 'workshop', 'break']),
    label: z.string().min(1),
    competitionId: z.uuid().nullish(),
    competitionPhase: z.enum(['pool', 'swiss', 'bracket', 'finals']).nullish(),
    workshopId: z.uuid().nullish(),
    liceCount: z.number().int().min(0),
    startTime: z.string().regex(HH_MM),
    endTime: z.string().regex(HH_MM),
    colorHex: z.string().regex(HEX_COLOR).nullish(),
  })
  .strict();
export class ProgrammeBlockDto extends createZodDto(programmeBlockSchema) {}

const saveProgrammeSchema = z
  .object({
    blocks: z.array(programmeBlockSchema),
  })
  .strict();
export class SaveProgrammeDto extends createZodDto(saveProgrammeSchema) {}

/**
 * Move a single programme block to a new start time on the same day.
 * Cascade-shifts every match scheduled at or after the block's OLD
 * start by the same Δ — keeps the visual ordering of the grid intact
 * when the operator drags a fixed bar.
 */
const moveBlockSchema = z
  .object({
    newStartTime: z.string().regex(HH_MM),
  })
  .strict();
export class MoveBlockDto extends createZodDto(moveBlockSchema) {}

/**
 * Push the rest of one day back by a measured delay, bars and bouts together.
 *
 * `fromTime` is the cut: everything starting at or after it moves. Bars need
 * that cut because a bar has no status to say it has already happened; a bout
 * is protected by its status as well, so one already fought or on a piste
 * stays where it is whatever the cut says.
 *
 * `deltaMinutes` is bounded at twelve hours in either direction. A day cannot
 * absorb more than that without crossing midnight, which the writer refuses
 * anyway — the bound is here so a mistyped figure is rejected by its shape
 * rather than by its consequences.
 */
const delayDaySchema = z
  .object({
    dayIndex: z.number().int().min(0),
    fromTime: z.string().regex(HH_MM),
    deltaMinutes: z.number().int().min(-720).max(720),
  })
  .strict();
export class DelayDayDto extends createZodDto(delayDaySchema) {}

/**
 * Resize a block by setting a new end and/or start time. The operator drags
 * the block's bottom edge (newEndTime) or top edge (newStartTime) on the grid;
 * the FE rounds to a 15-min slot and PATCHes the new HH:MM. Whichever field is
 * omitted keeps its current value, so a top-edge drag sends newStartTime alone.
 */
const resizeBlockSchema = z
  .object({
    newStartTime: z.string().regex(HH_MM).optional(),
    newEndTime: z.string().regex(HH_MM).optional(),
  })
  .strict();
export class ResizeBlockDto extends createZodDto(resizeBlockSchema) {}

/**
 * Re-fan a group of matches (a pool or a bracket sub-tree) across the given
 * lices from a start time. `mode` 'pool' keeps the group on one lice; 'bracket-
 * branch' applies branch-aware grouping (each quarter-final sub-tree on one
 * lice). The group lands after whatever already occupies those lices.
 */
const scheduleGroupSchema = z
  .object({
    matchIds: z.array(z.uuid()),
    liceIds: z.array(z.uuid()),
    startTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
    mode: z.enum(['pool', 'bracket-branch']),
  })
  .strict();
export class ScheduleGroupDto extends createZodDto(scheduleGroupSchema) {}

/** Update a single programme block (admin / break / workshop bar): label + color. */
const updateBlockLabelSchema = z
  .object({
    label: z.string().min(1),
    colorHex: z.string().regex(HEX_COLOR).nullish(),
  })
  .strict();
export class UpdateBlockLabelDto extends createZodDto(updateBlockLabelSchema) {}

/**
 * Create ONE programme block (used by the grid's "double-click → add break"
 * affordance and by Undo after a block is deleted). Unlike the bulk save this
 * appends a single row; `sortOrder` is assigned server-side (next on the day).
 * Competition-only fields default to the non-competition zero values.
 */
const createBlockSchema = z
  .object({
    dayIndex: z.number().int().min(0),
    blockType: z.enum(['admin', 'competition', 'workshop', 'break']),
    label: z.string().min(1),
    startTime: z.string().regex(HH_MM),
    endTime: z.string().regex(HH_MM),
    liceCount: z.number().int().min(0).optional(),
    competitionId: z.uuid().nullish(),
    competitionPhase: z.enum(['pool', 'swiss', 'bracket', 'finals']).nullish(),
    workshopId: z.uuid().nullish(),
    colorHex: z.string().regex(HEX_COLOR).nullish(),
  })
  .strict();
export class CreateBlockDto extends createZodDto(createBlockSchema) {}
