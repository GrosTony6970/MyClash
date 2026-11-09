/**
 * A session update's body is validated (slice 2.1). It was typed `Partial<CreateSessionBody>`,
 * which erases to `Object` at runtime: the pipe saw no Zod DTO, class-validator skips a plain
 * Object, and a body with `startTime: null` or any unknown key reached the database. Every board
 * move now goes through this route.
 *
 * The body type is read from the route's own parameter metadata, so the test holds the class the
 * route really declares.
 */
import 'reflect-metadata';
import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ZodOrClassValidationPipe } from '../../common/zod-or-class-validation.pipe';
import { WorkshopsController } from './workshops.controller';

const pipe = new ZodOrClassValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const paramTypes = Reflect.getMetadata(
  'design:paramtypes',
  WorkshopsController.prototype,
  'updateSession',
) as unknown[];
const meta: ArgumentMetadata = {
  type: 'body',
  metatype: paramTypes[1] as ArgumentMetadata['metatype'],
  data: '',
};

const VENUE = '11111111-1111-4111-8111-111111111111';

describe('PATCH workshop-sessions/:id body', () => {
  it('is a class of its own, not Object', () => {
    expect(paramTypes[1]).not.toBe(Object);
  });

  it('takes a move: times, a venue, and a room cleared with null', async () => {
    const body = {
      startTime: '2027-06-05T08:00:00.000Z',
      endTime: '2027-06-05T09:00:00.000Z',
      venueId: VENUE,
      areaId: null,
    };
    await expect(pipe.transform(body, meta)).resolves.toEqual(body);
  });

  it('refuses a null start, which would take the session off its day', async () => {
    await expect(pipe.transform({ startTime: null }, meta)).rejects.toThrow(BadRequestException);
  });

  it('refuses a key it does not know', async () => {
    await expect(pipe.transform({ workshopId: VENUE }, meta)).rejects.toThrow(BadRequestException);
  });
});
