import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createConversationSchema = z
  .object({
    tournamentId: z.string().uuid().nullable().optional(),
    title: z.string().max(200).nullable().optional(),
  })
  .strict();
export class CreateConversationDto extends createZodDto(createConversationSchema) {}

const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(4000),
  })
  .strict();
export class SendMessageDto extends createZodDto(sendMessageSchema) {}

const renameConversationSchema = z
  .object({
    title: z.string().min(1).max(200),
  })
  .strict();
export class RenameConversationDto extends createZodDto(renameConversationSchema) {}
