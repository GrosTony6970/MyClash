import {
  Body,
  type CanActivate,
  Controller,
  type DynamicModule,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import net from 'node:net';
import { z } from 'zod';
import { AdminFeatureFlagsService } from '../../modules/admin/admin-feature-flags.service';
import { GuestJwtService } from '../../modules/auth/guest-jwt.service';
import { StaffJwtService } from '../../modules/staff/staff-jwt.service';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import { buildSessionCookieOptions } from '../../security/http-security';
import type { ApiExceptionReporter } from '../api-exception.filter';
import { AuthGuard } from '../auth/auth.guard';
import { Public } from '../auth/public.decorator';
import { configureHttpApp } from '../http-bootstrap';
import { LockdownInterceptor } from '../interceptors/lockdown.interceptor';
import { ReadOnlyInterceptor } from '../interceptors/read-only.interceptor';
import { applyRequestLogging } from '../observability/request-logging.middleware';

/**
 * A small API built the way production builds it, for the edge tests (`http-edge*.http.test.ts`):
 * the real `configureHttpApp`, the real request-log wiring, the real `AuthGuard` as the global
 * guard and the real `LockdownInterceptor` and `ReadOnlyInterceptor` as global interceptors, in
 * AppModule's order, around test controllers. Only the services behind them are stubs: the login
 * marker is the one account, and it holds no platform role. Every value is a synthetic plain
 * string.
 */

export const LOGIN_MARKER = 'probe-marker-login';
export const CLASS_GUARD_MARKER = 'probe-marker-class-guard';
export const ALLOWED_ORIGIN = 'https://app.myclash.localhost';

export interface EdgeAppOptions {
  authMode: 'enforce' | 'shadow';
  readOnly?: boolean;
  lockdown?: boolean;
  reportException?: ApiExceptionReporter;
}

/** Stands in for a class-level guard such as PlatformRoleGuard, with an answer of its own. */
@Injectable()
export class MarkerRefuser implements CanActivate {
  canActivate(): boolean {
    throw new UnauthorizedException(CLASS_GUARD_MARKER);
  }
}

class EchoDto extends createZodDto(z.object({ marker: z.string() }).strict()) {}

type UploadRequest = FastifyRequest & {
  file: () => Promise<{ toBuffer: () => Promise<Buffer> } | undefined>;
};

@Controller('edge')
class EdgeController {
  @Post('echo')
  @HttpCode(HttpStatus.OK)
  echo(@Body() dto: EchoDto): { marker: string } {
    return { marker: dto.marker };
  }

  @Get('signed-in')
  signedIn(): { ok: string } {
    return { ok: 'probe-marker-signed-in' };
  }

  @Public()
  @Get('public')
  publicRead(): { ok: string } {
    return { ok: 'probe-marker-public' };
  }

  @Public()
  @Get('cookie')
  cookie(@Req() req: FastifyRequest & { cookies?: Record<string, string> }): { value: unknown } {
    return { value: req.cookies?.['probe-marker-cookie'] ?? null };
  }

  @Public()
  @Post('set-cookie')
  @HttpCode(HttpStatus.OK)
  setCookie(@Res({ passthrough: true }) reply: FastifyReply): { ok: true } {
    const withCookies = reply as FastifyReply & {
      setCookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    };
    withCookies.setCookie(
      'probe-marker-session',
      'probe-marker-value',
      buildSessionCookieOptions({ env: 'production' }),
    );
    return { ok: true };
  }

  /** Reads the upload exactly as the backup restore does (backups.controller.ts). */
  @Public()
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  async upload(@Req() req: FastifyRequest): Promise<{ bytes: number }> {
    const data = await (req as UploadRequest).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return { bytes: buffer.length };
  }

  @Public()
  @Get('boom')
  boom(): never {
    throw new Error('probe-marker-boom');
  }

  @Public()
  @Get('uri-error')
  uriError(): never {
    throw new URIError('probe-marker-uri');
  }
}

/** Under /api/v1/auth/, the read-only switch's allowlist. */
@Controller('auth')
class EdgeAllowlistedController {
  @Post('edge-allowlisted')
  @HttpCode(HttpStatus.OK)
  allowed(): { ok: string } {
    return { ok: 'probe-marker-allowlisted' };
  }
}

/** Under /api/v1/orgs/, which the maintenance lockdown locks whole. */
@Controller('orgs')
class EdgeLockedController {
  @Post(':orgId/probe')
  @HttpCode(HttpStatus.OK)
  save(): { ok: string } {
    return { ok: 'probe-marker-locked' };
  }
}

@Controller('class-guarded')
@UseGuards(MarkerRefuser)
class ClassGuardedController {
  @Get('read')
  read(): { ok: string } {
    return { ok: 'probe-marker-class-guarded' };
  }
}

@Controller('class-public')
@Public()
class ClassPublicController {
  @Get('read')
  read(): { ok: string } {
    return { ok: 'probe-marker-class-public' };
  }
}

/** Excluded from the global prefix, as the real health check is. */
@Controller()
class EdgeHealthController {
  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'probe-marker-health' };
  }
}

@Module({})
class EdgeModule implements NestModule {
  static with(options: EdgeAppOptions): DynamicModule {
    return {
      module: EdgeModule,
      controllers: EDGE_CONTROLLERS,
      providers: edgeProviders(options),
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    applyRequestLogging(consumer);
  }
}

const EDGE_CONTROLLERS = [
  EdgeController,
  EdgeAllowlistedController,
  EdgeLockedController,
  ClassGuardedController,
  ClassPublicController,
  EdgeHealthController,
];

/** The platform_roles read (`platform-role.ts`) finds no row: no account here is staff. */
const noPlatformRole = {
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
};

const failVerify = {
  verify: (): never => {
    throw new Error('no session');
  },
};

function edgeProviders(options: EdgeAppOptions): DynamicModule['providers'] {
  return [
    MarkerRefuser,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LockdownInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ReadOnlyInterceptor },
    {
      provide: ConfigService,
      useValue: {
        get: (key: string) => (key === 'AUTH_GUARD_MODE' ? options.authMode : undefined),
      },
    },
    {
      provide: SupabaseService,
      useValue: {
        verifyAccessTokenLocal: (token: string) =>
          token === LOGIN_MARKER ? { id: 'probe-marker-user', email: null } : null,
        getAuthUser: async (token: string) =>
          token === LOGIN_MARKER ? { id: 'probe-marker-user' } : null,
        service: { from: () => noPlatformRole },
      },
    },
    { provide: GuestJwtService, useValue: failVerify },
    { provide: StaffJwtService, useValue: failVerify },
    {
      provide: AdminFeatureFlagsService,
      useValue: {
        isEnabled: async (flag: string) =>
          (flag === 'read_only_mode' && !!options.readOnly) ||
          (flag === 'admin_lockdown' && !!options.lockdown),
      },
    },
  ];
}

export interface EdgeApp {
  app: NestFastifyApplication;
  base: string;
  port: number;
}

/**
 * Builds and starts the edge app on a free local port. Through `NestFactory.create`, as main.ts
 * does, not `Test.createNestApplication`: the two order Fastify's hooks and Nest's middleware
 * differently (Nest 12.2 release notes, "the request hook … now runs before Nest and app.use()
 * middleware with NestFactory.create() too"), and a CORS preflight shows it.
 */
export async function buildEdgeApp(options: EdgeAppOptions): Promise<EdgeApp> {
  const app = await NestFactory.create<NestFastifyApplication>(
    EdgeModule.with(options),
    new FastifyAdapter(),
    { logger: false },
  );
  await configureHttpApp(app, { reportException: options.reportException ?? (() => undefined) });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, base: `http://127.0.0.1:${address.port}`, port: address.port };
}

export interface RawAnswer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Sends one request line as written, for the targets `fetch` rewrites (an absolute-form target,
 * a percent-encoded letter, a double slash).
 */
export function rawRequest(
  port: number,
  method: string,
  target: string,
  headers: Record<string, string> = {},
): Promise<RawAnswer> {
  const extra = Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('');
  const request = `${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\n${extra}Connection: close\r\n\r\n`;
  return new Promise((resolve, reject) => {
    let text = '';
    const socket = net.connect(port, '127.0.0.1', () => socket.write(request));
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (text += chunk));
    socket.on('error', reject);
    socket.on('end', () => resolve(parseRaw(text)));
  });
}

function parseRaw(text: string): RawAnswer {
  const split = text.indexOf('\r\n\r\n');
  const [statusLine = '', ...lines] = text.slice(0, split).split('\r\n');
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status: Number(statusLine.split(' ')[1]), headers, body: text.slice(split + 4) };
}
