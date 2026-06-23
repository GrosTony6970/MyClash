import 'reflect-metadata';
import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createZodDto } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodOrClassValidationPipe } from './zod-or-class-validation.pipe';

const pipe = new ZodOrClassValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

// ── A Zod DTO (the migration target) ──
class ZodWidgetDto extends createZodDto(z.object({ name: z.string() }).strict()) {}
const zodMeta: ArgumentMetadata = { type: 'body', metatype: ZodWidgetDto, data: '' };

// ── A legacy class-validator DTO (must keep working) ──
class CvWidgetDto {
  @IsString()
  name!: string;
}
const cvMeta: ArgumentMetadata = { type: 'body', metatype: CvWidgetDto, data: '' };

describe('ZodOrClassValidationPipe', () => {
  it('validates Zod DTOs with Zod and returns the parsed value', async () => {
    await expect(pipe.transform({ name: 'sword' }, zodMeta)).resolves.toEqual({ name: 'sword' });
  });

  it('rejects invalid Zod DTO input', async () => {
    await expect(pipe.transform({ name: 42 }, zodMeta)).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown fields on a strict Zod DTO (forbidNonWhitelisted parity)', async () => {
    await expect(pipe.transform({ name: 'sword', sneaky: true }, zodMeta)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('still validates legacy class-validator DTOs (no regression)', async () => {
    await expect(pipe.transform({ name: 'shield' }, cvMeta)).resolves.toEqual({ name: 'shield' });
    await expect(pipe.transform({ name: 99 }, cvMeta)).rejects.toThrow(BadRequestException);
    // forbidNonWhitelisted still applies to class-validator DTOs
    await expect(pipe.transform({ name: 'shield', extra: 1 }, cvMeta)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('passes primitive params through unchanged', async () => {
    const meta: ArgumentMetadata = { type: 'param', metatype: String, data: 'id' };
    await expect(pipe.transform('abc-123', meta)).resolves.toBe('abc-123');
  });
});
