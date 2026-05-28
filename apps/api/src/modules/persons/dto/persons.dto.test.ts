import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreatePersonDto } from './persons.dto';

/**
 * Locks the "newClubName" invariants for the add-participant flow:
 *   - the field is optional and accepts a non-empty trimmed string;
 *   - it is mutually exclusive with `clubId` (sending both → 400);
 *   - whitespace-only values are rejected.
 *
 * The class-level validator enforces both rules so a malformed
 * payload is rejected at the ValidationPipe boundary, before it
 * reaches PersonsService.createPerson.
 */
describe('CreatePersonDto — newClubName', () => {
  const base = { givenName: 'Jean', familyName: 'Dupont' };

  it('accepts a valid newClubName when clubId is absent', async () => {
    const dto = plainToInstance(CreatePersonDto, { ...base, newClubName: 'Lyon AMHE' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });

  it('accepts neither newClubName nor clubId', async () => {
    const dto = plainToInstance(CreatePersonDto, base);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });

  it('rejects sending both clubId and newClubName', async () => {
    const dto = plainToInstance(CreatePersonDto, {
      ...base,
      clubId: '00000000-0000-0000-0000-000000000001',
      newClubName: 'Lyon AMHE',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toMatch(
      /clubId.*newClubName|newClubName.*clubId|mutually exclusive/i,
    );
  });

  it('rejects a whitespace-only newClubName', async () => {
    const dto = plainToInstance(CreatePersonDto, { ...base, newClubName: '   ' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});
