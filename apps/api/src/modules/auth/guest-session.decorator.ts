/**
 * @GuestSession() parameter decorator.
 *
 * Extracts the guest session payload from the request (set by GuestJwtGuard).
 * Use in controller methods to get the bound person_id without re-verifying.
 *
 * Usage:
 *   @Get('my-schedule')
 *   async getSchedule(@GuestSession() session: GuestJwtPayload) {
 *     return this.service.getSchedule(session.person_id);
 *   }
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { GuestJwtPayload } from './guest-jwt.service';

export const GuestSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GuestJwtPayload | null => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return (request as FastifyRequest & { guestSession?: GuestJwtPayload }).guestSession ?? null;
  },
);
