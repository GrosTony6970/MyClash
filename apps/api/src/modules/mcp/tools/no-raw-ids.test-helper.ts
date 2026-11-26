import { expect } from 'vitest';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The one check every tool test runs: no UUID-shaped string at any depth of a tool's output, in a
 * key or a value. A model has no use for a raw id, and later tools take a slug.
 */
export function expectNoRawIds(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(UUID);
}
