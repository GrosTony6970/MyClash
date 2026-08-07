import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@myclash/types';
import { atLeastPlatformRole } from '@myclash/types';
import type { FastifyRequest } from 'fastify';
import { resolvePlatformRole } from '../../../common/auth/platform-role';
import { SupabaseService } from '../../supabase/supabase.service';
import { PLATFORM_ROLE_KEY } from './platform-role.decorator';

type GoTrueAuthUser = {
  id: string;
  app_metadata?: Record<string, unknown>;
};

function isAuthUser(value: unknown): value is GoTrueAuthUser {
  return Boolean(
    value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string',
  );
}

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Gates a route on the caller's platform tier.
 *
 * ## The formula — read this before adding a decorator anywhere
 *
 *   explicit = @PlatformRole(...) on the handler, else on the class
 *   isRead   = method is GET or HEAD
 *
 *   min = isRead ? (explicit === 'super_admin' ? 'super_admin' : 'platform_viewer')
 *                : (explicit ?? 'super_admin')
 *
 * In words: **reads are open to every platform tier, writes are super-admin
 * only, and a decorator moves a route off that default.** Three consequences,
 * each of which has to be stated because each is a trap:
 *
 * 1. `@PlatformRole('platform_admin')` on a GET is a SILENT NO-OP. It cannot
 *    be used to hide a read from viewers — only `'super_admin'` narrows a read.
 *    This is exactly what makes a class-level `@PlatformRole('platform_admin')`
 *    do the right thing (writes open to admins, reads open to all three)
 *    instead of locking viewers out of an entire controller.
 * 2. `platform_viewer` can never pass a non-GET, on any route, with any
 *    decorator. There is no way to express it, by design.
 * 3. A handler decorator overrides a class decorator; there is no merging.
 *
 * Verb-default rather than an explicit tier on all ~200 routes because the
 * default is the safe direction: forgetting a decorator reserves a route to
 * super-admins, which is a support ticket. The opposite default would make a
 * forgotten decorator a privilege escalation.
 *
 * ## Constraints inherited from AuthGuard — do not relax them
 *
 * Default-scoped only. Never inject a `Scope.REQUEST` provider, never mark a
 * dependency `@Optional()` (undefined deps fail open), always value-import
 * injected services (`import type` erases the DI metadata Nest needs).
 *
 * Its three dependencies are all GLOBAL on purpose. `ClubsModule`,
 * `PrivacyModule` and `OrganizationsModule` attach this guard without
 * providing it — Nest registers a `@UseGuards(Class)` enhancer as an
 * injectable of the *host* module and resolves the constructor from that
 * module's injector. Adding a dependency that only `AdminModule` provides
 * would fail to resolve in those modules at real boot, not in tests.
 *
 * ## It authenticates too, deliberately
 *
 * The global `AuthGuard` runs in SHADOW mode by default (`AUTH_GUARD_MODE`),
 * where it logs a would-401 and lets the request through. So this guard cannot
 * assume an identity is already attached: it extracts and verifies the token
 * itself, via a GoTrue round-trip. That is affordable here — a few dozen admin
 * routes, not all ~573.
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Authentication required');

    const user = await this.requestAuthUser(token);
    if (!user) throw new UnauthorizedException('Invalid or expired token');

    const tier = await this.resolveTier(user);
    if (!tier) throw new ForbiddenException('Platform access required');

    const min = this.requiredTier(context, request);
    if (!atLeastPlatformRole(tier, min)) {
      throw new ForbiddenException('Platform access required');
    }

    // BOTH stamps are load-bearing. `actorUserId` is what getActorId() reads —
    // without it every audit write on the route throws. `platformRole` is what
    // controllers and services read to branch below the guard.
    const stamped = request as FastifyRequest & {
      actorUserId?: string;
      platformRole?: PlatformRole;
    };
    stamped.actorUserId = user.id;
    stamped.platformRole = tier;
    return true;
  }

  /** See the class docblock. Kept separate so the coverage test can reach it. */
  private requiredTier(context: ExecutionContext, request: FastifyRequest): PlatformRole {
    const explicit = this.reflector.getAllAndOverride<'platform_admin' | 'super_admin' | undefined>(
      PLATFORM_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const isRead = READ_METHODS.has((request.method ?? 'GET').toUpperCase());
    if (isRead) return explicit === 'super_admin' ? 'super_admin' : 'platform_viewer';
    return explicit ?? 'super_admin';
  }

  /**
   * The tier the caller holds, or null.
   *
   * The `app_metadata.role` fallback is preserved from SuperAdminGuard, and
   * only ever yields `super_admin`: SQL `is_super_admin()` honours the very
   * same JWT claim (0002_rls.sql), and `scripts/bootstrap-super-admin.mjs`
   * relies on it to create the first account. Dropping it would make the API
   * stricter than the RLS it is supposed to mirror. There is no claim for the
   * lower tiers and there should not be — they exist only as table rows.
   */
  private async resolveTier(user: GoTrueAuthUser): Promise<PlatformRole | null> {
    const stored = await resolvePlatformRole(this.supabase, user.id);
    if (stored) return stored;
    return user.app_metadata?.['role'] === 'super_admin' ? 'super_admin' : null;
  }

  private async requestAuthUser(accessToken: string): Promise<GoTrueAuthUser | null> {
    const authUrl =
      this.config.get<string>('SUPABASE_AUTH_INTERNAL_URL') ??
      this.config.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    let response: {
      ok: boolean;
      json: () => Promise<unknown>;
    };

    try {
      response = await fetch(`${authUrl.replace(/\/+$/u, '')}/user`, {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok || !body || typeof body !== 'object') {
      return null;
    }

    const record = body as Record<string, unknown>;
    if (isAuthUser(record)) return record;
    if (isAuthUser(record['user'])) return record['user'];
    return null;
  }

  private extractToken(request: FastifyRequest): string | null {
    const auth = request.headers['authorization'];
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    return cookies?.['sb-access-token'] ?? null;
  }
}
