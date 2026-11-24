/**
 * auth.guard.test.ts — AuthGuard
 *
 * Tests:
 *   ✓ shadow mode never throws, even for an anonymous caller on a guarded route
 *   ✓ enforce mode throws 401 for an anonymous caller on a guarded route
 *   ✓ enforce mode lets an anonymous caller through a @Public() route
 *   ✓ resolves a claimed user from a Bearer header and from the cookie
 *   ✓ resolves guest and staff cookies
 *   ✓ a dead/forged token degrades to anonymous rather than throwing
 *   ✓ identity is attached even on @Public() routes (it gates the throw only)
 *   ✓ identity is written to req.raw as well as req (middleware reads req.raw)
 *   ✓ non-http contexts are ignored
 */

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthGuard } from './auth.guard';
import { CONNECTOR_DOOR_KEY } from './connector-door';
import { getConnectorClientId, type Identity } from './identity';

const verifyAccessTokenLocal = vi.fn();
const mockSupabase = { verifyAccessTokenLocal };

const guestVerify = vi.fn();
const mockGuestJwt = { verify: guestVerify };

const staffVerify = vi.fn();
const mockStaffJwt = { verify: staffVerify };

const reflectorGetAllAndOverride = vi.fn();
const mockReflector = { getAllAndOverride: reflectorGetAllAndOverride };

let mode = 'shadow';
const mockConfig = { get: vi.fn(() => mode) };

type RequestShape = {
  method: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  identity?: Identity;
  staffSession?: unknown;
  raw: { identity?: Identity };
};

function makeContext(opts: {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  isPublic?: boolean;
  connectorDoor?: boolean;
  type?: string;
}): { context: ExecutionContext; request: RequestShape } {
  const {
    headers = {},
    cookies = {},
    isPublic = false,
    connectorDoor = false,
    type = 'http',
  } = opts;

  reflectorGetAllAndOverride.mockImplementation((key: string) => {
    if (key === CONNECTOR_DOOR_KEY) return connectorDoor ? true : undefined;
    return isPublic ? true : undefined;
  });

  // NOTE: `.raw` is present on purpose. The sibling harness
  // (event-readonly.guard.test.ts) mocks a bare object without it, which is
  // exactly why a wrapper-only identity write could go unnoticed.
  const request: RequestShape = { method: 'DELETE', headers, cookies, raw: {} };

  const context = {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({ name: 'handler' }),
    getClass: () => ({ name: 'TestController' }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    mode = 'shadow';
    verifyAccessTokenLocal.mockReturnValue(null);
    guestVerify.mockImplementation(() => {
      throw new Error('invalid');
    });
    staffVerify.mockImplementation(() => {
      throw new Error('invalid');
    });
    guard = new AuthGuard(
      mockReflector as never,
      mockSupabase as never,
      mockGuestJwt as never,
      mockStaffJwt as never,
      mockConfig as never,
    );
  });

  // ── mode ────────────────────────────────────────────────────────────────────

  it('shadow mode lets an anonymous caller through a guarded route', async () => {
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('enforce mode rejects an anonymous caller on a guarded route', async () => {
    mode = 'enforce';
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enforce mode lets an anonymous caller through a @Public() route', async () => {
    mode = 'enforce';
    const { context } = makeContext({ isPublic: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('defaults to shadow when AUTH_GUARD_MODE is unset', async () => {
    mockConfig.get.mockReturnValueOnce(undefined as never);
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  // ── identity resolution ─────────────────────────────────────────────────────

  it('resolves a claimed user from the Authorization header', async () => {
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1', email: 'a@b.c' });
    mode = 'enforce';
    const { context, request } = makeContext({ headers: { authorization: 'Bearer tok' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAccessTokenLocal).toHaveBeenCalledWith('tok');
    expect(request.identity).toEqual({ kind: 'claimed', userId: 'user-1', email: 'a@b.c' });
  });

  it('resolves a claimed user from the sb-access-token cookie', async () => {
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1' });
    const { context, request } = makeContext({ cookies: { 'sb-access-token': 'tok' } });

    await guard.canActivate(context);
    expect(request.identity).toEqual({ kind: 'claimed', userId: 'user-1', email: null });
  });

  it('resolves a guest cookie', async () => {
    guestVerify.mockReturnValue({ sub: 'gs-1', person_id: 'p-1', event_id: 'e-1' });
    mode = 'enforce';
    const { context, request } = makeContext({ cookies: { mc_guest: 'g' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.identity).toEqual({
      kind: 'guest',
      guestSessionId: 'gs-1',
      personId: 'p-1',
      eventId: 'e-1',
    });
  });

  it('resolves a staff cookie', async () => {
    staffVerify.mockReturnValue({ sub: 's-1', event_id: 'e-1' });
    mode = 'enforce';
    const { context, request } = makeContext({ cookies: { mc_staff: 's' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.identity).toEqual({ kind: 'staff', staffId: 's-1', eventId: 'e-1' });
    expect(request.staffSession).toEqual({ staffId: 's-1', eventId: 'e-1' });
  });

  it('claimed wins over a guest cookie presented at the same time', async () => {
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1' });
    guestVerify.mockReturnValue({ sub: 'gs-1', person_id: 'p-1', event_id: 'e-1' });
    const { context, request } = makeContext({
      headers: { authorization: 'Bearer tok' },
      cookies: { mc_guest: 'g' },
    });

    await guard.canActivate(context);
    expect(request.identity?.kind).toBe('claimed');
  });

  it('keeps a verified staff session beside the identity that won', async () => {
    // A scoring pad where someone once signed in carries both cookies: the
    // login is on `.myclash.fr`. The identity is the login; the staff session
    // must still reach the checks that ask for it (ruling 81).
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1' });
    staffVerify.mockReturnValue({ sub: 's-1', event_id: 'e-1' });
    const { context, request } = makeContext({
      headers: { authorization: 'Bearer tok' },
      cookies: { mc_staff: 's' },
    });

    await guard.canActivate(context);
    expect(request.identity?.kind).toBe('claimed');
    expect(request.staffSession).toEqual({ staffId: 's-1', eventId: 'e-1' });
  });

  it('degrades a forged or expired token to anonymous instead of throwing', async () => {
    // verify throws; the guard must swallow it and fall through, not 500.
    const { context, request } = makeContext({ cookies: { mc_guest: 'bad', mc_staff: 'bad' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.identity).toEqual({ kind: 'anonymous' });
    expect(request.staffSession).toBeNull();
  });

  // ── the two traps the sibling harness cannot catch ──────────────────────────

  it('attaches identity on @Public() routes too — @Public gates the throw, not resolution', async () => {
    // Regression guard: if the reflector check short-circuits before identity
    // resolution, req.identity is undefined on the highest-traffic routes
    // (GET /me, GET /events, the feature-flag poll) and a later
    // `identity ?? anonymous` coalesce silently reinstates fail-open.
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1', email: 'a@b.c' });
    mode = 'enforce';
    const { context, request } = makeContext({
      isPublic: true,
      headers: { authorization: 'Bearer tok' },
    });

    await guard.canActivate(context);
    expect(request.identity).toEqual({ kind: 'claimed', userId: 'user-1', email: 'a@b.c' });
  });

  it('attaches identity to req.raw as well as req (middleware only sees req.raw)', async () => {
    // Regression guard: Nest hands guards the Fastify wrapper but hands
    // middleware `req.raw`. A wrapper-only write leaves actorId undefined in
    // every request log, silently.
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1' });
    const { context, request } = makeContext({ headers: { authorization: 'Bearer tok' } });

    await guard.canActivate(context);
    expect(request.raw.identity).toEqual({ kind: 'claimed', userId: 'user-1', email: null });
    expect(request.raw.identity).toEqual(request.identity);
  });

  it('marks anonymous on a @Public() route as anonymous, not undefined', async () => {
    const { context, request } = makeContext({ isPublic: true });

    await guard.canActivate(context);
    expect(request.identity).toEqual({ kind: 'anonymous' });
    expect(request.raw.identity).toEqual({ kind: 'anonymous' });
  });

  // ── Claude connector token ──────────────────────────────────────────────────

  // The wall reads the claim unverified, so the tokens must really carry it.
  const connectorToken = jwt.sign({ sub: 'user-1', client_id: 'claude-client' }, 'any-secret');
  const connectorLogin = { headers: { authorization: `Bearer ${connectorToken}` } };

  it('refuses a connector token in the cookie behind a junk Bearer', async () => {
    const { context } = makeContext({
      headers: { authorization: 'Bearer junk' },
      cookies: { 'sb-access-token': connectorToken },
    });
    await expect(guard.canActivate(context)).rejects.toThrow('connector_token_outside_mcp');
  });

  it('refuses a connector token that fails verification', async () => {
    verifyAccessTokenLocal.mockReturnValue(null);
    const { context } = makeContext(connectorLogin);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not make an unverified connector claim the door identity', async () => {
    verifyAccessTokenLocal.mockReturnValue(null);
    const { context, request } = makeContext({ ...connectorLogin, connectorDoor: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getConnectorClientId(request as never)).toBeNull();
  });

  it('refuses a connector token on an unmarked route, in shadow mode', async () => {
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1', clientId: 'claude-client' });
    const { context } = makeContext(connectorLogin);
    const refusal = guard.canActivate(context);
    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refusal).rejects.toThrow('connector_token_outside_mcp');
  });

  it('refuses a connector token on an unmarked route, in enforce mode', async () => {
    mode = 'enforce';
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1', clientId: 'claude-client' });
    const { context } = makeContext(connectorLogin);
    const refusal = guard.canActivate(context);
    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refusal).rejects.toThrow('connector_token_outside_mcp');
  });

  it('refuses a connector token even on a @Public() route', async () => {
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1', clientId: 'claude-client' });
    const { context } = makeContext({ ...connectorLogin, isPublic: true });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a connector token through a ConnectorDoor route', async () => {
    mode = 'enforce';
    verifyAccessTokenLocal.mockReturnValue({
      id: 'user-1',
      email: 'a@b.c',
      clientId: 'claude-client',
    });
    const { context, request } = makeContext({ ...connectorLogin, connectorDoor: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.identity).toEqual({ kind: 'claimed', userId: 'user-1', email: 'a@b.c' });
    expect(getConnectorClientId(request as never)).toBe('claude-client');
  });

  it('a login without client_id carries no connector client', async () => {
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1' });
    const { context, request } = makeContext({ headers: { authorization: 'Bearer tok' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getConnectorClientId(request as never)).toBeNull();
  });

  it('an empty client_id claim is no connector', async () => {
    verifyAccessTokenLocal.mockReturnValue({ id: 'user-1', clientId: '' });
    const emptyClaim = jwt.sign({ sub: 'user-1', client_id: '' }, 'any-secret');
    const { context, request } = makeContext({
      headers: { authorization: `Bearer ${emptyClaim}` },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getConnectorClientId(request as never)).toBeNull();
  });

  // ── non-http ────────────────────────────────────────────────────────────────

  it('ignores non-http execution contexts', async () => {
    mode = 'enforce';
    const { context } = makeContext({ type: 'rpc' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
