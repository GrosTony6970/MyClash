import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(256),
    newPassword: z.string().max(256),
  })
  .strict();
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

const deleteAccountSchema = z
  .object({
    currentPassword: z.string().max(256),
    confirmation: z.enum(['DELETE']),
  })
  .strict();
export class DeleteAccountDto extends createZodDto(deleteAccountSchema) {}
