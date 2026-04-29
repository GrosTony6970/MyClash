/**
 * GuestJwtGuard — verifies the mc_guest httpOnly cookie.
 *
 * On success: attaches the decoded payload to request.guestSession.
 * On failure: throws UnauthorizedException.
 *
 * Use with @UseGuards(GuestJwtGuard) on endpoints that require a guest session.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { GuestJwtPayload } from './guest-jwt.service';
import { GuestJwtService } from './guest-jwt.service';

@Injectable()
export class GuestJwtGuard implements CanActivate {
  constructor(private readonly guestJwt: GuestJwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const token = cookies?.['mc_guest'];

    if (!token) {
      throw new UnauthorizedException('Guest session required');
    }

    const payload = this.guestJwt.verify(token);
    (request as FastifyRequest & { guestSession?: GuestJwtPayload }).guestSession = payload;
    return true;
  }
}
