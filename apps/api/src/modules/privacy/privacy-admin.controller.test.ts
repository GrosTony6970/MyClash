import { describe, expect, it } from 'vitest';
import { UpdateRetentionDto } from './privacy-admin.controller';

describe('UpdateRetentionDto', () => {
  const schema = UpdateRetentionDto.schema;

  it('accepts the safety-flag horizon from 0 to 10000', () => {
    expect(schema.safeParse({ sparFlagDays: 0 }).success).toBe(true);
    expect(schema.safeParse({ sparFlagDays: 730 }).success).toBe(true);
    expect(schema.safeParse({ sparFlagDays: 10000 }).success).toBe(true);
  });

  it('refuses a safety-flag horizon outside that range or not a whole number', () => {
    expect(schema.safeParse({ sparFlagDays: -1 }).success).toBe(false);
    expect(schema.safeParse({ sparFlagDays: 10001 }).success).toBe(false);
    expect(schema.safeParse({ sparFlagDays: 1.5 }).success).toBe(false);
  });
});
