/**
 * Guest session JWT service.
 *
 * Signs and verifies guest session tokens using MYCLASH_GUEST_JWT_SECRET —
 * a secret DISTINCT from the Supabase JWT secret. This ensures guest sessions
 * can NEVER be promoted into Supabase auth tokens, even if one secret leaks.
 *
 * Token payload:
 *   { sub: sessionId, person_id: personId, event_id: eventId, type: 'guest' }
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

export interface GuestJwtPayload {
  sub: string; // guest_session.id
  person_id: string;
  event_id: string;
  type: 'guest';
  iat: number;
  exp: number;
}

@Injectable()
export class GuestJwtService {
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.secret = config.getOrThrow<string>('MYCLASH_GUEST_JWT_SECRET');
  }

  sign(payload: Omit<GuestJwtPayload, 'iat' | 'exp'>, expiresAt: Date): string {
    const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    return jwt.sign(payload, this.secret, { expiresIn });
  }

  verify(token: string): GuestJwtPayload {
    try {
      return jwt.verify(token, this.secret) as GuestJwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired guest session token');
    }
  }
}
