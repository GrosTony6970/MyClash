import { describe, expect, it } from 'vitest';
import { UpdatePhaseVisibilityDto } from './phases.dto';

/**
 * Regression guard for the pool publish/unpublish flow. The frontend PATCHes
 * /api/v1/phases/:phaseId/visibility with `{ visibility, confirmStarted? }`.
 * `.strict()` keeps the forbidNonWhitelisted hygiene the global pipe provided.
 */
const schema = UpdatePhaseVisibilityDto.schema;

describe('UpdatePhaseVisibilityDto — publish/unpublish payload', () => {
  it('accepts the publish payload', () => {
    expect(schema.safeParse({ visibility: 'published', confirmStarted: true }).success).toBe(true);
  });

  it('accepts an unpublish payload without confirmStarted', () => {
    expect(schema.safeParse({ visibility: 'hidden' }).success).toBe(true);
  });

  it('rejects an invalid visibility value', () => {
    expect(schema.safeParse({ visibility: 'sometimes' }).success).toBe(false);
  });

  it('rejects an unknown sibling field (strict)', () => {
    expect(schema.safeParse({ visibility: 'published', surprise: 'x' }).success).toBe(false);
  });
});
