import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

export interface StaffJwtPayload {
  sub: string;
  event_id: string;
  type: 'staff';
  iat: number;
  exp: number;
}

@Injectable()
export class StaffJwtService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('MYCLASH_STAFF_JWT_SECRET');
    if (configured) {
      this.secret = configured;
      return;
    }
    if (config.get<string>('NODE_ENV') === 'production') {
      this.secret = config.getOrThrow<string>('MYCLASH_STAFF_JWT_SECRET');
      return;
    }
    this.secret = 'dev-staff-secret-change-me';
  }

  sign(payload: Omit<StaffJwtPayload, 'iat' | 'exp'>, expiresAt: Date): string {
    const expiresIn = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    return jwt.sign(payload, this.secret, { expiresIn });
  }

  verify(token: string): StaffJwtPayload {
    try {
      const payload = jwt.verify(token, this.secret) as StaffJwtPayload;
      if (payload.type !== 'staff') throw new Error('wrong token type');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired staff session');
    }
  }
}
