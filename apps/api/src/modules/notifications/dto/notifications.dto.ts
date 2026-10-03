import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Nested element schema for SubscribeDto.keys (was PushSubscriptionKeysDto).
// Not whitelisted (no .strict()) to match prior @ValidateNested behavior.
const pushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

// A browser's push address. Bounded: it is the key of a unique index (0219).
const endpointSchema = z.url().max(2048);

const subscribeSchema = z
  .object({
    endpoint: endpointSchema,
    keys: pushSubscriptionKeysSchema,
  })
  .strict();
export class SubscribeDto extends createZodDto(subscribeSchema) {}

const pushAddressSchema = z.object({ endpoint: endpointSchema }).strict();
export class PushAddressDto extends createZodDto(pushAddressSchema) {}

const updateNotificationPreferencesSchema = z
  .object({
    matchStartingMinutesBefore: z.number().int().min(0).max(240).optional(),
    workshopStartingMinutesBefore: z.number().int().min(0).max(240).optional(),
    refereeStartingMinutesBefore: z.number().int().min(0).max(240).optional(),
    scheduleChanges: z.boolean().optional(),
    resultsPublished: z.boolean().optional(),
    /** New event published by an organiser you follow. */
    organizerUpdates: z.boolean().optional(),
    /** Next Swiss round paired — your opponent and piste. */
    swissRoundPublished: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export class UpdateNotificationPreferencesDto extends createZodDto(
  updateNotificationPreferencesSchema,
) {}

const sendBroadcastNotificationSchema = z
  .object({
    targetType: z.enum([
      'all',
      'fighters',
      'referees',
      'fighters_and_referees',
      'specific_persons',
    ]),
    personIds: z.array(z.uuid()).max(500).optional(),
    tournamentId: z.uuid().optional(),
    severity: z.enum(['info', 'warning', 'alert']),
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(1000),
  })
  .strict();
export class SendBroadcastNotificationDto extends createZodDto(sendBroadcastNotificationSchema) {}
