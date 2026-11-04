import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

/**
 * The phone's photo cookie: a random id, signed with its own secret (never COOKIE_SECRET, which
 * falls back to a dev string), so the per-device limit can count a phone without knowing who
 * holds it.
 *
 * A convenience limit, not a security boundary: a phone that drops its cookie gets a new id. So a
 * missing or bad cookie is never a refusal; it is a new phone. The per-Event caps are what bound
 * a phone that keeps resetting.
 */
export const PHOTO_DEVICE_COOKIE = 'mc_photo_device';
export const PHOTO_DEVICE_TTL_DAYS = 30;

const TYPE = 'photo_device';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PhotoDeviceService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('PHOTO_DEVICE_JWT_SECRET');
  }

  deviceOf(cookie: unknown): { deviceId: string; fresh: boolean } {
    if (typeof cookie === 'string' && cookie !== '') {
      try {
        const payload = jwt.verify(cookie, this.secret) as { sub?: unknown; type?: unknown };
        if (payload.type === TYPE && typeof payload.sub === 'string' && UUID.test(payload.sub)) {
          return { deviceId: payload.sub, fresh: false };
        }
      } catch {
        // A bad cookie is a new phone, not a refusal.
      }
    }
    return { deviceId: randomUUID(), fresh: true };
  }

  sign(deviceId: string): { token: string; expires: Date } {
    const expires = new Date(Date.now() + PHOTO_DEVICE_TTL_DAYS * 86_400_000);
    const token = jwt.sign({ sub: deviceId, type: TYPE }, this.secret, {
      expiresIn: PHOTO_DEVICE_TTL_DAYS * 86_400,
    });
    return { token, expires };
  }
}
