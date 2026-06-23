import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Narrow payload — only `maintenance_banner` opts in today, so the
 * shape is captured directly here rather than as an open `Record`.
 * Other flag keys reject any payload.
 */
const maintenanceBannerPayloadSchema = z
  .object({
    message: z.string(),
    severity: z.enum(['info', 'warning', 'critical']),
  })
  .strict();
export class MaintenanceBannerPayloadDto extends createZodDto(maintenanceBannerPayloadSchema) {}

const upsertFeatureFlagSchema = z
  .object({
    description: z.string().optional(),
    enabled: z.boolean(),
    /**
     * Structured config attached to flags that declare `payload` in the
     * registry (today only `maintenance_banner`). Sent as a plain object
     * to keep the contract simple; the service validates the shape
     * against the registry entry before persisting.
     */
    payloadJson: z.record(z.string(), z.unknown()).nullish(),
  })
  .strict();
export class UpsertFeatureFlagDto extends createZodDto(upsertFeatureFlagSchema) {}

const featureFlagKeyParamSchema = z
  .object({
    key: z.string().min(1),
  })
  .strict();
export class FeatureFlagKeyParamDto extends createZodDto(featureFlagKeyParamSchema) {}
