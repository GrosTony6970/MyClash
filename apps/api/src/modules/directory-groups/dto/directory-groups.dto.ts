import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export class CreateGroupDto extends createZodDto(createGroupSchema) {}

const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((d) => d.name !== undefined || d.sortOrder !== undefined, {
    message: 'Provide name or sortOrder',
  });
export class UpdateGroupDto extends createZodDto(updateGroupSchema) {}

const addMemberSchema = z
  .object({
    globalPersonId: z.uuid().optional(),
    slug: z.string().min(1).max(120).optional(),
  })
  .strict()
  .refine((d) => Boolean(d.globalPersonId) !== Boolean(d.slug), {
    message: 'Provide exactly one of globalPersonId or slug',
  });
export class AddMemberDto extends createZodDto(addMemberSchema) {}
