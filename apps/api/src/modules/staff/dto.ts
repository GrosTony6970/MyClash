import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createStaffAccountSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    username: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9._-]+$/),
    pin: z
      .string()
      .min(4)
      .max(12)
      .regex(/^[0-9]+$/),
  })
  .strict();
export class CreateStaffAccountDto extends createZodDto(createStaffAccountSchema) {}

const updateStaffAccountSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    username: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict();
export class UpdateStaffAccountDto extends createZodDto(updateStaffAccountSchema) {}

const resetStaffPinSchema = z
  .object({
    pin: z
      .string()
      .min(4)
      .max(12)
      .regex(/^[0-9]+$/),
  })
  .strict();
export class ResetStaffPinDto extends createZodDto(resetStaffPinSchema) {}

const setStaffLicesSchema = z
  .object({
    liceIds: z
      .array(z.uuid())
      .max(64)
      .refine((a) => new Set(a).size === a.length, 'must be unique'),
  })
  .strict();
export class SetStaffLicesDto extends createZodDto(setStaffLicesSchema) {}

const staffLoginSchema = z
  .object({
    eventSlugOrCode: z.string().min(1).max(160),
    username: z.string().min(3).max(64),
    pin: z.string().min(4).max(12),
  })
  .strict();
export class StaffLoginDto extends createZodDto(staffLoginSchema) {}

const staffHeartbeatSchema = z
  .object({
    outboxDepth: z.number().int().min(0),
    oldestPendingAgeSec: z.number().int().min(0),
    rejectedCount: z.number().int().min(0),
  })
  .strict();
export class StaffHeartbeatDto extends createZodDto(staffHeartbeatSchema) {}
