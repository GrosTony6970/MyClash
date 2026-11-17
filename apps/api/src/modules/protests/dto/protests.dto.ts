import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Record a protest: one tap on the pad when a Fighter disputes the referee's call. */
export const createProtestSchema = z
  .object({
    /** The pad's id of the tap: a resend with it answers the saved row. */
    clientUuid: z.uuid(),
    /** From the pad's one counter that Exchanges and cards share: orders the Match's history. */
    sequence: z.number().int().min(1),
    /** The Fighter who protests: the red or the blue Registration of the Match. */
    registrationId: z.uuid(),
    occurredAt: z.iso.datetime(),
    /** The pad's time of this send, as on a card. */
    sentAt: z.iso.datetime().optional(),
    /** Match-clock position (active ms); the pad sends null when it has no clock to report. */
    clockTimeMs: z.number().int().min(0).nullable().optional(),
  })
  .strict();

export class CreateProtestDto extends createZodDto(createProtestSchema) {}

const voidProtestSchema = z.object({ reason: z.string().max(500).optional() }).strict();
export class VoidProtestDto extends createZodDto(voidProtestSchema) {}
