import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const HH_MM = /^\d{2}:\d{2}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const suggestProgrammeSchema = z
  .object({
    dayStartTime: z.string().regex(HH_MM),
    dayEndTime: z.string().regex(HH_MM),
    parallelLiceCount: z.number().int().min(1),
    poolMatchDurationMinutes: z.number().int().min(1),
    /**
     * Optional, and the schema is `.strict()` — required would 400 every
     * suggest from a client predating the Swiss format. Absent falls back to
     * `poolMatchDurationMinutes`.
     */
    swissMatchDurationMinutes: z.number().int().min(1).optional(),
    eliminationMatchDurationMinutes: z.number().int().min(1),
    finalsMatchDurationMinutes: z.number().int().min(1),
    matchGapSeconds: z.number().int().min(0),
    minRestMinutes: z.number().int().min(0),
    breakBetweenSessionsMinutes: z.number().int().min(0),
    middayBreakStart: z.string().regex(HH_MM),
    middayBreakEnd: z.string().regex(HH_MM),
    registrationDurationMinutes: z.number().int().min(0),
    gearCheckDurationMinutes: z.number().int().min(0),
    refereeMeetingDurationMinutes: z.number().int().min(0),
  })
  .strict();
export class SuggestProgrammeDto extends createZodDto(suggestProgrammeSchema) {}

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
    matchGapSeconds: z.number().int().min(0),
    matchDurationMinutes: z.number().int().min(0),
    minRestMinutes: z.number().int().min(0),
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
    matchDurationMinutes: z.number().int().min(1).optional(),
    matchGapSeconds: z.number().int().min(0).optional(),
    minRestMinutes: z.number().int().min(0).optional(),
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
    matchGapSeconds: z.number().int().min(0).optional(),
    matchDurationMinutes: z.number().int().min(0).optional(),
    minRestMinutes: z.number().int().min(0).optional(),
    competitionId: z.uuid().nullish(),
    competitionPhase: z.enum(['pool', 'swiss', 'bracket', 'finals']).nullish(),
    workshopId: z.uuid().nullish(),
    colorHex: z.string().regex(HEX_COLOR).nullish(),
  })
  .strict();
export class CreateBlockDto extends createZodDto(createBlockSchema) {}
