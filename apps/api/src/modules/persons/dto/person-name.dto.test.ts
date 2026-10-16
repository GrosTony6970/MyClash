import { describe, expect, it } from 'vitest';
import {
  CreateFighterDto,
  CreateGlobalPersonDto,
  UpdateFighterDto,
  UpdateGlobalPersonDto,
} from '../../fighters/dto/fighters.dto';
import { createPersonSchema, updatePersonSchema } from './persons.dto';

/**
 * A name of spaces is no name. "  " passed `min(1)`, the service trimmed it to "", and the public
 * roster, sorted by name, put that person first with no name at all.
 */
const SCHEMAS = [
  ['a participant', createPersonSchema, {}],
  ['a participant edited', updatePersonSchema, {}],
  ['a fighter', CreateFighterDto.schema, { displayName: 'Jean Dupont' }],
  ['a fighter edited', UpdateFighterDto.schema, {}],
  ['a global profile', CreateGlobalPersonDto.schema, {}],
  ['a global profile edited', UpdateGlobalPersonDto.schema, {}],
] as const;

describe('a name of spaces is refused', () => {
  it.each(SCHEMAS)('%s', (_, schema, more) => {
    const named = { givenName: 'Jean', familyName: 'Dupont', ...more };
    expect(schema.safeParse(named).success).toBe(true);
    expect(schema.safeParse({ ...named, givenName: '   ' }).success).toBe(false);
    expect(schema.safeParse({ ...named, familyName: ' ' }).success).toBe(false);
  });

  it('keeps the name, its spaces at the ends taken off', () => {
    const parsed = createPersonSchema.parse({ givenName: ' Jean ', familyName: 'Dupont' });
    expect(parsed.givenName).toBe('Jean');
  });
});
