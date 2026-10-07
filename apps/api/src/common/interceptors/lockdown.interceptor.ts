import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { adminLockdownRefusal } from '../admin-lockdown';
import { AdminFeatureFlagsService } from '../../modules/admin/admin-feature-flags.service';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import { isPlatformStaff } from '../auth/platform-role';

/** Locked whole: a read too. */
const LOCKED_PREFIXES = ['/api/v1/admin/', '/api/v1/orgs/', '/api/v1/global-persons'];

/**
 * Locked for a save only: the public site and the pad read these (operator ruling 327).
 * `organizations` is the club's own addresses, which this list did not have (ruling 327a).
 *
 * NOT a list of every save: the roster, the Pools, the schedule and the Workshops have no
 * first word of their own, and the pad's scoring is among them and must stay open.
 */
const SAVE_LOCKED_PREFIXES = [
  '/api/v1/events/',
  '/api/v1/tournaments/',
  '/api/v1/organizations',
  '/api/v1/clubs',
  '/api/v1/leagues',
];

function isLocked(method: string, path: string): boolean {
  if (LOCKED_PREFIXES.some((p) => path.startsWith(p))) return true;
  const read = method === 'GET' || method === 'HEAD';
  return !read && SAVE_LOCKED_PREFIXES.some((p) => path.startsWith(p));
}

const ALLOWLIST = [
  '/api/v1/auth/',
  '/api/v1/health',
  '/api/v1/public/',
  // Reading public event-listings without auth must still work
  '/api/v1/events?',
];

/**
 * Lockdown interceptor: when the `admin_lockdown` flag is enabled, any
 * authenticated request to a locked address from an account that is not
 * platform staff is rejected with HTTP 503. Platform staff and unauthenticated
 * public requests pass through unaffected.
 *
 * A read under Events, Tournaments, organizations, clubs and Leagues passes for
 * everybody (operator ruling 327): a signed-in Fighter on the public site and
 * an account on the pad read what a visitor with no login reads. A save there
 * is refused.
 */
@Injectable()
export class LockdownInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LockdownInterceptor.name);

  constructor(
    private readonly flags: AdminFeatureFlagsService,
    private readonly supabase: SupabaseService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const path: string = (req.url ?? '').toString();

    if (ALLOWLIST.some((p) => path.startsWith(p))) return next.handle();
    if (!isLocked(req.method, path)) return next.handle();

    const token = this.extractToken(req);
    if (!token) return next.handle();

    const lockdownOn = await this.flags.isEnabled('admin_lockdown');
    if (!lockdownOn) return next.handle();

    const userId = await this.resolveUserId(token);
    if (!userId) return next.handle();

    const isSuperAdmin = await this.isPlatformStaff(userId);
    if (isSuperAdmin) return next.handle();

    throw adminLockdownRefusal();
  }

  private extractToken(req: FastifyRequest): string | null {
    const auth = req.headers['authorization'];
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    return cookies?.['sb-access-token'] ?? null;
  }

  private async resolveUserId(token: string): Promise<string | null> {
    try {
      const user = await this.supabase.getAuthUser(token);
      return user?.id ?? null;
    } catch (err) {
      this.logger.warn(`Failed to resolve user during lockdown check: ${String(err)}`);
      return null;
    }
  }

  /**
   * ANY platform tier, not just super-admin.
   *
   * `admin_lockdown` means "only platform staff touch admin surfaces while we
   * sort this out". Locking out the platform admins too would leave nobody but
   * one account able to help during the incident the switch was flipped for.
   * Safe to widen because this interceptor only decides whether the request
   * continues — PlatformRoleGuard still applies the route's own tier on top.
   */
  private async isPlatformStaff(userId: string): Promise<boolean> {
    return isPlatformStaff(this.supabase, userId);
  }
}
