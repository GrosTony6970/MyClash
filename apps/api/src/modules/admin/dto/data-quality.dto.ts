import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export type DataQualityFindingStatus = 'open' | 'dismissed' | 'resolved';

const updateDataQualityFindingSchema = z
  .object({
    status: z.enum(['open', 'dismissed', 'resolved']),
  })
  .strict();
export class UpdateDataQualityFindingDto extends createZodDto(updateDataQualityFindingSchema) {}

export type DataQualityScanMode = 'ai' | 'deterministic';

const startDataQualityScanSchema = z
  .object({
    /**
     * `ai` (default) runs the LLM-ranked path — costs per call.
     * `deterministic` skips the LLM, persists rule-derived candidates
     * with confidence = 1.0. Used by the daily cron + the operator's
     * "Run deterministic scan" button.
     */
    mode: z.enum(['ai', 'deterministic']).optional(),
  })
  .strict();
export class StartDataQualityScanDto extends createZodDto(startDataQualityScanSchema) {}
