import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdatePhaseVisibilityDto } from './phases.dto';

/**
 * Regression guard for the pool publish/unpublish flow on
 * /org/{slug}/events/{eventId}/pools.
 *
 * The frontend PATCHes /api/v1/phases/:phaseId/visibility with
 * `{ visibility: 'published' | 'hidden', confirmStarted?: boolean }`.
 * The global ValidationPipe runs with `forbidNonWhitelisted: true`
 * (see apps/api/src/main.ts), which strips/rejects properties that
 * have no class-validator decorators. Before this fix the DTO had
 * no decorators on either field — every publish request 400'd with
 * `property visibility should not exist`.
 */
describe('UpdatePhaseVisibilityDto — publish/unpublish payload', () => {
  it('accepts the exact payload the pools page sends to publish', async () => {
    const dto = plainToInstance(UpdatePhaseVisibilityDto, {
      visibility: 'published',
      confirmStarted: true,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });

  it('accepts an unpublish payload without confirmStarted', async () => {
    const dto = plainToInstance(UpdatePhaseVisibilityDto, {
      visibility: 'hidden',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });

  it('rejects an invalid visibility value (whitelist still active)', async () => {
    const dto = plainToInstance(UpdatePhaseVisibilityDto, {
      visibility: 'sometimes',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an unknown sibling field (forbidNonWhitelisted guard)', async () => {
    const dto = plainToInstance(UpdatePhaseVisibilityDto, {
      visibility: 'published',
      surprise: 'x',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
