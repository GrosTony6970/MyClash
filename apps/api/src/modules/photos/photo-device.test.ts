import * as jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { PHOTO_DEVICE_TTL_DAYS, PhotoDeviceService } from './photo-device';

const SECRET = 'test-photo-device-secret-at-least-32-characters';
const service = new PhotoDeviceService({ getOrThrow: () => SECRET } as never);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('PhotoDeviceService', () => {
  it('recognises a phone by the cookie it signed', () => {
    const { token } = service.sign('6f9619ff-8b86-4011-b42d-00c04fc964ff');
    expect(service.deviceOf(token)).toEqual({
      deviceId: '6f9619ff-8b86-4011-b42d-00c04fc964ff',
      fresh: false,
    });
  });

  it.each([
    ['no cookie', undefined],
    ['an empty cookie', ''],
    ['a tampered cookie', `${service.sign('6f9619ff-8b86-4011-b42d-00c04fc964ff').token}x`],
    [
      'a cookie signed with another secret',
      jwt.sign({ sub: 'a', type: 'photo_device' }, `${SECRET}-other`),
    ],
    ['a guest session cookie', jwt.sign({ sub: 'a', type: 'guest' }, SECRET)],
    ['a cookie whose id is not a uuid', jwt.sign({ sub: 'x', type: 'photo_device' }, SECRET)],
  ])('gives %s a new id instead of refusing the photo', (_name, cookie) => {
    const { deviceId, fresh } = service.deviceOf(cookie);
    expect(fresh).toBe(true);
    expect(deviceId).toMatch(UUID);
  });

  it('signs for thirty days', () => {
    const { expires } = service.sign('6f9619ff-8b86-4011-b42d-00c04fc964ff');
    const days = (expires.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(PHOTO_DEVICE_TTL_DAYS - 0.01);
    expect(days).toBeLessThan(PHOTO_DEVICE_TTL_DAYS + 0.01);
    expect(PHOTO_DEVICE_TTL_DAYS).toBe(30);
  });
});
