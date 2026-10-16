import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { trustOneLocalProxy } from '../trust-proxy';
import { ThrottleByStaffAccount } from './throttle-by-staff-account';
import { throttlerOptions } from './throttler-options';

/**
 * The PIN sign-in of one staff account: ten wrong PINs an hour (operator, 2026-10-16, O3).
 *
 * A referee signs in again after each tablet reboot, with the right PIN. The count ran before
 * the PIN check, so the eleventh good sign-in of the hour was refused. Only a wrong PIN counts.
 *
 * Real requests through the app's throttler config and this interceptor. The probe answers as
 * `StaffService.login` does: 401 for a wrong PIN, 200 for the good one. No @Throttle on it, as on
 * the real route: its only per-IP ceiling is the global 120/min, so a 429 here is this count.
 */
@Controller('t')
class ProbeController {
  @Post('staff-login')
  @HttpCode(HttpStatus.OK)
  @ThrottleByStaffAccount()
  staffLogin(@Body() body: { pin?: string; disabled?: boolean }): { ok: true } {
    return signIn(body);
  }

  @Post('staff-other')
  @HttpCode(HttpStatus.OK)
  @ThrottleByStaffAccount()
  staffOther(@Body() body: { pin?: string }): { ok: true } {
    return signIn(body);
  }

  @Post('unmarked')
  @HttpCode(HttpStatus.OK)
  unmarked(@Body() body: { pin?: string }): { ok: true } {
    return signIn(body);
  }

  /** Answers once every try sent with it has started: the ten-at-once race. */
  @Post('staff-slow')
  @HttpCode(HttpStatus.OK)
  @ThrottleByStaffAccount()
  async staffSlow(@Body() body: { pin?: string }): Promise<{ ok: true }> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return signIn(body);
  }
}

function signIn(body: { pin?: string; disabled?: boolean }): { ok: true } {
  if (body.disabled) throw new ForbiddenException('Staff account is disabled');
  if (body.pin !== 'good') throw new UnauthorizedException('Invalid staff credentials');
  return { ok: true };
}

let app: NestFastifyApplication;

const ORIGINAL = process.env.THROTTLE_IP_WHITELIST;

async function post(url: string, body: Record<string, unknown>, ip: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url,
    headers: { 'x-forwarded-for': ip },
    payload: body,
  });
  return res.statusCode;
}

const wrong = (account: Record<string, unknown>) => ({ ...account, pin: 'wrong' });
const good = (account: Record<string, unknown>) => ({ ...account, pin: 'good' });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(throttlerOptions)],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(
    // Mirrors main.ts: without trustProxy the X-Forwarded-For above is ignored.
    new FastifyAdapter({ trustProxy: trustOneLocalProxy }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.THROTTLE_IP_WHITELIST;
  else process.env.THROTTLE_IP_WHITELIST = ORIGINAL;
});

describe('@ThrottleByStaffAccount — only a wrong PIN counts', () => {
  it('never counts a good PIN: thirty sign-ins in an hour all pass', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const account = { eventSlugOrCode: 'open-2026', username: 'rebooting-ref' };

    for (let i = 0; i < 30; i++) {
      expect(await post('/t/staff-login', good(account), `10.30.0.${i}`)).toBe(200);
    }
  });

  it('refuses the account after ten wrong PINs, even from eleven addresses, good PIN or not', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const account = { eventSlugOrCode: 'open-2026', username: 'ref1' };

    for (let i = 0; i < 10; i++) {
      expect(await post('/t/staff-login', wrong(account), `10.20.0.${i}`)).toBe(401);
    }
    // The case a venue-wide IP bucket cannot see: 11 sources, one account.
    expect(await post('/t/staff-login', wrong(account), '10.20.0.99')).toBe(429);
    expect(await post('/t/staff-login', good(account), '10.20.0.98')).toBe(429);
  });

  it('counts the wrong PINs between good ones, and only them', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const account = { eventSlugOrCode: 'open-2026', username: 'fumbling-ref' };

    for (let i = 0; i < 9; i++) {
      expect(await post('/t/staff-login', wrong(account), `10.31.0.${i}`)).toBe(401);
      expect(await post('/t/staff-login', good(account), `10.31.1.${i}`)).toBe(200);
    }
    expect(await post('/t/staff-login', wrong(account), '10.31.0.99')).toBe(401);
    expect(await post('/t/staff-login', good(account), '10.31.1.99')).toBe(429);
  });

  it('does not count a sign-in refused for another reason than the PIN', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const account = { eventSlugOrCode: 'open-2026', username: 'disabled-ref', disabled: true };

    for (let i = 0; i < 12; i++) {
      expect(await post('/t/staff-login', wrong(account), `10.32.0.${i}`)).toBe(403);
    }
  });

  // Counted on their answer alone, all fifteen would pass the check before the first was refused.
  it('holds at ten when fifteen wrong PINs are sent at once', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const account = { eventSlugOrCode: 'open-2026', username: 'burst' };

    const answers = await Promise.all(
      Array.from({ length: 15 }, (_, i) => post('/t/staff-slow', wrong(account), `10.33.0.${i}`)),
    );

    expect(answers.filter((status) => status === 401)).toHaveLength(10);
    expect(answers.filter((status) => status === 429)).toHaveLength(5);
  });

  it('leaves a whole hall of DIFFERENT referees on one NAT address alone', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    // Not keyed on req.ip: every tablet in the venue shares one public address, and fumbling a
    // PIN is normal.
    for (let i = 0; i < 20; i++) {
      expect(
        await post(
          '/t/staff-login',
          wrong({ eventSlugOrCode: 'open-2026', username: `hall-ref-${i}` }),
          '10.21.0.1',
        ),
      ).toBe(401);
    }
  });

  it('is keyed per event, so the same username at another event is untouched', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    for (let i = 0; i < 11; i++) {
      await post(
        '/t/staff-login',
        wrong({ eventSlugOrCode: 'noisy-event', username: 'shared' }),
        `10.22.0.${i}`,
      );
    }
    expect(
      await post(
        '/t/staff-login',
        good({ eventSlugOrCode: 'other-event', username: 'shared' }),
        '10.22.0.99',
      ),
    ).toBe(200);
  });

  it('shares one count across staff login surfaces', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const account = { eventSlugOrCode: 'shared-bucket', username: 'ref2' };

    for (let i = 0; i < 10; i++) {
      expect(await post('/t/staff-login', wrong(account), `10.23.0.${i}`)).toBe(401);
    }
    expect(await post('/t/staff-other', wrong(account), '10.23.0.99')).toBe(429);
  });

  // Spacing as well as case: the login body puts no character rule on the username and sign-in
  // trims before the lookup, so `  REF3  ` reaches `ref3` and has to spend `ref3`'s allowance.
  it('normalizes case and spacing on both halves, so neither is a way around it', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    for (let i = 0; i < 10; i++) {
      await post(
        '/t/staff-login',
        wrong({ eventSlugOrCode: 'case-event', username: 'ref3' }),
        `10.24.0.${i}`,
      );
    }
    expect(
      await post(
        '/t/staff-login',
        wrong({ eventSlugOrCode: ' Case-Event ', username: '  REF3  ' }),
        '10.24.0.99',
      ),
    ).toBe(429);
  });

  // Ruling 52: sign-in finds the event by its id when one is sent and never reads the typed name
  // then, so a made-up name per try must not be a fresh allowance for the same account.
  it('counts by the event id when one is sent, whatever event name comes with it', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const eventId = '2a7d0f4e-1b3c-4d5e-8f60-718293a4b5c6';

    for (let i = 0; i < 10; i++) {
      await post(
        '/t/staff-login',
        wrong({ eventId, eventSlugOrCode: `made-up-${i}`, username: 'ref6' }),
        `10.29.0.${i}`,
      );
    }
    // Postgres reads a uuid in either case, so capitals are the same event.
    expect(
      await post(
        '/t/staff-login',
        wrong({ eventId: eventId.toUpperCase(), eventSlugOrCode: 'made-up-99', username: 'ref6' }),
        '10.29.0.99',
      ),
    ).toBe(429);
  });

  it('does not count requests that carry no resolvable account', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    // A missing half means the pipe should 400 it, not that every malformed request should
    // share one count and 429 each other.
    for (let i = 0; i < 12; i++) {
      expect(await post('/t/staff-login', wrong({ username: 'no-event' }), `10.25.0.${i}`)).toBe(
        401,
      );
    }
    for (let i = 0; i < 12; i++) {
      expect(
        await post('/t/staff-login', wrong({ eventSlugOrCode: 'no-user' }), `10.26.0.${i}`),
      ).toBe(401);
    }
  });

  it('leaves unmarked routes alone', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    for (let i = 0; i < 12; i++) {
      expect(
        await post(
          '/t/unmarked',
          wrong({ eventSlugOrCode: 'open-2026', username: 'ref4' }),
          `10.27.0.${i}`,
        ),
      ).toBe(401);
    }
  });

  it('exempts whitelisted IPs', async () => {
    process.env.THROTTLE_IP_WHITELIST = '10.28.0.1';
    const account = { eventSlugOrCode: 'open-2026', username: 'ref5' };

    for (let i = 0; i < 15; i++) {
      expect(await post('/t/staff-login', wrong(account), '10.28.0.1')).toBe(401);
    }
  });
});
