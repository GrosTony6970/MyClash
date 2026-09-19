import 'reflect-metadata';
import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ZodOrClassValidationPipe } from '../../../common/zod-or-class-validation.pipe';
import { CreateRegistrationDto } from './registrations.dto';

/**
 * The body an organiser's roster page sends to enter a person in a tournament.
 *
 * The page sends `hemaRatingsId: null` when its HEMA Ratings field is empty
 * (`persons/page.tsx`: the add form, the edit form, and the waiting-list retry
 * that re-sends the same body). Until 2026-09-19 the schema said
 * `z.string().optional()`, so null was a 400 and the person was not entered.
 * Null means "no HEMA Ratings id" (operator ruling 32).
 *
 * Driven through the global pipe, as a request meets it: the pipe sends a Zod DTO
 * to Zod, and the schema alone would not show that.
 */
const pipe = new ZodOrClassValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const body: ArgumentMetadata = { type: 'body', metatype: CreateRegistrationDto, data: '' };

const ANNA = '33333333-3333-4333-8333-333333333333';

describe('the body the roster page sends to enter a person', () => {
  it('accepts an empty HEMA Ratings field, which the page sends as null', async () => {
    await expect(pipe.transform({ personId: ANNA, hemaRatingsId: null }, body)).resolves.toEqual({
      personId: ANNA,
      hemaRatingsId: null,
    });
  });

  it('accepts a HEMA Ratings id, and a body without the field', async () => {
    await expect(pipe.transform({ personId: ANNA, hemaRatingsId: '12345' }, body)).resolves.toEqual(
      { personId: ANNA, hemaRatingsId: '12345' },
    );
    await expect(pipe.transform({ personId: ANNA }, body)).resolves.toEqual({ personId: ANNA });
  });

  it('still refuses a HEMA Ratings id that is not text', async () => {
    await expect(pipe.transform({ personId: ANNA, hemaRatingsId: 12345 }, body)).rejects.toThrow(
      BadRequestException,
    );
  });
});
