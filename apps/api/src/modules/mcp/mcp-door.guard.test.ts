/**
 * The MCP door's sign-in check, run the way a request meets it: the real AuthGuard first (real
 * Reflector, reading the real `McpController` metadata), then `McpDoorGuard`. The tokens are real
 * signed logins, so nothing is fed through a mock of the login check.
 */
import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthGuard } from '../../common/auth/auth.guard';
import { verifyAccessTokenLocally } from '../supabase/access-token';
import { McpController } from './mcp.controller';
import { McpDoorGuard, mcpCallerOf } from './mcp-door.guard';
import { ProtectedResourceController } from './protected-resource.controller';

const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const env: Record<string, string> = {
  AUTH_GUARD_MODE: 'enforce',
  DOMAIN: 'myclash.fr',
  SUPABASE_URL: 'https://app.myclash.fr',
};
const config = {
  get: (key: string) => env[key],
  getOrThrow: (key: string) => {
    if (env[key] === undefined) throw new Error(`missing ${key}`);
    return env[key];
  },
};
const refuse = {
  verify: () => {
    throw new Error('no such cookie');
  },
};

const CHALLENGE =
  'Bearer resource_metadata="https://api.myclash.fr/.well-known/oauth-protected-resource/api/v1/mcp", scope="email profile offline_access"';

const sign = (claims: object, options: jwt.SignOptions = { expiresIn: 3600 }) =>
  jwt.sign(claims, SECRET, options);
const connector = sign({ sub: 'user-1', email: 'a@b.c', client_id: 'claude-client' });
const browserLogin = sign({ sub: 'user-1', email: 'a@b.c' });
const expiredConnector = sign(
  { sub: 'user-1', client_id: 'claude-client', exp: Math.floor(Date.now() / 1000) - 60 },
  {},
);

type FakeRequest = {
  method: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  raw: Record<string, unknown>;
};

function contextFor(
  cls: object,
  handler: object,
  request: FakeRequest,
): { context: ExecutionContext; headers: Map<string, string> } {
  const headers = new Map<string, string>();
  const reply = {
    header: (name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return reply;
    },
  };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
  return { context, headers };
}

const request = (opts: { bearer?: string; cookie?: string }): FakeRequest => ({
  method: 'POST',
  headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
  cookies: opts.cookie ? { 'sb-access-token': opts.cookie } : {},
  raw: {},
});

let authGuard: AuthGuard;
let doorGuard: McpDoorGuard;

beforeEach(() => {
  authGuard = new AuthGuard(
    new Reflector(),
    { verifyAccessTokenLocal: (token: string) => verifyAccessTokenLocally(token, SECRET) } as never,
    refuse as never,
    refuse as never,
    config as never,
  );
  doorGuard = new McpDoorGuard(config as never);
});

/** Both guards, in the order Nest runs them on the door. */
async function atTheDoor(req: FakeRequest) {
  const { context, headers } = contextFor(McpController, McpController.prototype.handle, req);
  await expect(authGuard.canActivate(context)).resolves.toBe(true);
  try {
    return { passed: doorGuard.canActivate(context), headers, error: null };
  } catch (error) {
    return { passed: false, headers, error };
  }
}

describe('McpDoorGuard', () => {
  it('answers 401 with the resource-metadata challenge when no Bearer is sent', async () => {
    const { error, headers } = await atTheDoor(request({}));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(headers.get('www-authenticate')).toBe(CHALLENGE);
  });

  it('refuses a cookie-only request', async () => {
    const { error, headers } = await atTheDoor(request({ cookie: connector }));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(headers.get('www-authenticate')).toBe(CHALLENGE);
  });

  it('refuses a browser login sent as Bearer (no client_id)', async () => {
    const { error, headers } = await atTheDoor(request({ bearer: browserLogin }));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token", resource_metadata="https://api.myclash.fr/.well-known/oauth-protected-resource/api/v1/mcp", scope="email profile offline_access"',
    );
  });

  it('refuses an expired connector token', async () => {
    const { error, headers } = await atTheDoor(request({ bearer: expiredConnector }));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('lets a connector Bearer through', async () => {
    const req = request({ bearer: connector });
    const { passed, headers } = await atTheDoor(req);
    expect(passed).toBe(true);
    expect(headers.size).toBe(0);
    expect(mcpCallerOf(req as never)).toEqual({
      userId: 'user-1',
      email: 'a@b.c',
      clientId: 'claude-client',
    });
  });

  it('gives a request it never passed no caller', () => {
    expect(() => mcpCallerOf(request({ bearer: connector }) as never)).toThrow();
  });
});

describe("AuthGuard's wall reads McpDoor's class-level mark", () => {
  it('lets a connector token past the wall on McpController', async () => {
    const { context } = contextFor(
      McpController,
      McpController.prototype.handle,
      request({ bearer: connector }),
    );
    await expect(authGuard.canActivate(context)).resolves.toBe(true);
  });

  it('refuses it on a controller without the mark, though that one is public', async () => {
    const { context } = contextFor(
      ProtectedResourceController,
      ProtectedResourceController.prototype.root,
      request({ bearer: connector }),
    );
    await expect(authGuard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
