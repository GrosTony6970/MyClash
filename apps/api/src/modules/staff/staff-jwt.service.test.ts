import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { StaffJwtService } from './staff-jwt.service';

describe('StaffJwtService', () => {
  it('signs and verifies staff-only session tokens', () => {
    const service = new StaffJwtService(
      new ConfigService({ MYCLASH_STAFF_JWT_SECRET: 'test-staff-secret' }),
    );

    const token = service.sign(
      { sub: 'staff-1', event_id: 'event-1', type: 'staff' },
      new Date(Date.now() + 60_000),
    );

    expect(service.verify(token)).toMatchObject({
      sub: 'staff-1',
      event_id: 'event-1',
      type: 'staff',
    });
  });

  it('rejects tokens signed for another purpose', () => {
    const service = new StaffJwtService(
      new ConfigService({ MYCLASH_STAFF_JWT_SECRET: 'test-staff-secret' }),
    );
    const token = service.sign(
      { sub: 'staff-1', event_id: 'event-1', type: 'staff' },
      new Date(Date.now() + 60_000),
    );
    const otherService = new StaffJwtService(
      new ConfigService({ MYCLASH_STAFF_JWT_SECRET: 'other-secret' }),
    );

    expect(() => otherService.verify(token)).toThrow(UnauthorizedException);
  });
});
