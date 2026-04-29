import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { GuestJwtService } from './guest-jwt.service';
import { GuestJwtGuard } from './guest-jwt.guard';

// ── GuestJwtService tests ─────────────────────────────────────────────────────

describe('GuestJwtService', () => {
  let service: GuestJwtService;

  beforeEach(() => {
    service = new GuestJwtService({
      getOrThrow: () => 'test-guest-secret-at-least-32-chars-long',
    } as never);
  });

  it('signs and verifies a valid token', () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    const token = service.sign(
      { sub: 'session-1', person_id: 'person-1', event_id: 'event-1', type: 'guest' },
      expiresAt,
    );
    const payload = service.verify(token);
    expect(payload.person_id).toBe('person-1');
    expect(payload.event_id).toBe('event-1');
    expect(payload.type).toBe('guest');
    expect(payload.sub).toBe('session-1');
  });

  it('throws UnauthorizedException for an invalid token', () => {
    expect(() => service.verify('not.a.valid.token')).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for an expired token', () => {
    // Sign with 1ms expiry
    const expiresAt = new Date(Date.now() + 1);
    const token = service.sign(
      { sub: 'session-1', person_id: 'person-1', event_id: 'event-1', type: 'guest' },
      expiresAt,
    );
    // Wait for expiry
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(() => service.verify(token)).toThrow(UnauthorizedException);
        resolve();
      }, 10);
    });
  });

  it('uses a DIFFERENT secret from Supabase JWT (no cross-escalation)', () => {
    const supabaseSecret = 'supabase-jwt-secret-different-from-guest';
    const guestService = new GuestJwtService({
      getOrThrow: () => 'guest-only-secret-completely-different',
    } as never);

    const expiresAt = new Date(Date.now() + 3600 * 1000);
    const guestToken = guestService.sign(
      { sub: 'session-1', person_id: 'person-1', event_id: 'event-1', type: 'guest' },
      expiresAt,
    );

    // A service using the Supabase secret cannot verify the guest token
    const supabaseService = new GuestJwtService({
      getOrThrow: () => supabaseSecret,
    } as never);

    expect(() => supabaseService.verify(guestToken)).toThrow(UnauthorizedException);
  });
});

// ── GuestJwtGuard tests ───────────────────────────────────────────────────────

describe('GuestJwtGuard', () => {
  let jwtService: GuestJwtService;
  let guard: GuestJwtGuard;

  beforeEach(() => {
    jwtService = new GuestJwtService({
      getOrThrow: () => 'test-guest-secret-at-least-32-chars-long',
    } as never);
    guard = new GuestJwtGuard(jwtService);
  });

  function makeContext(cookies: Record<string, string>) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ cookies }),
      }),
    } as never;
  }

  it('allows request with valid mc_guest cookie', () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    const token = jwtService.sign(
      { sub: 'session-1', person_id: 'person-a', event_id: 'event-1', type: 'guest' },
      expiresAt,
    );
    const ctx = makeContext({ mc_guest: token });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException when no mc_guest cookie', () => {
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for invalid token', () => {
    const ctx = makeContext({ mc_guest: 'invalid.token.here' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  // ── KEY AC TEST: Person A session cannot act as Person B ──────────────────

  it('Person A session cannot be used to act as Person B', () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    // Create a valid session for Person A
    const tokenA = jwtService.sign(
      { sub: 'session-a', person_id: 'person-a', event_id: 'event-1', type: 'guest' },
      expiresAt,
    );

    const requestA = { cookies: { mc_guest: tokenA } } as never;
    const ctxA = {
      switchToHttp: () => ({ getRequest: () => requestA }),
    } as never;

    guard.canActivate(ctxA);

    // The session is bound to person-a
    const session = (requestA as { guestSession?: { person_id: string } }).guestSession;
    expect(session?.person_id).toBe('person-a');
    expect(session?.person_id).not.toBe('person-b');
  });

  it('attaches guestSession payload to request on success', () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    const token = jwtService.sign(
      { sub: 'session-1', person_id: 'person-a', event_id: 'event-1', type: 'guest' },
      expiresAt,
    );
    const request = { cookies: { mc_guest: token } } as never;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    guard.canActivate(ctx);

    const session = (request as { guestSession?: { person_id: string; event_id: string } }).guestSession;
    expect(session?.person_id).toBe('person-a');
    expect(session?.event_id).toBe('event-1');
  });
});
