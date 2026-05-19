import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { AdminFeatureFlagsService } from '../../modules/admin/admin-feature-flags.service';
import { SupabaseService } from '../../modules/supabase/supabase.service';

const PROTECTED_PREFIXES = [
  '/api/v1/admin/',
  '/api/v1/orgs/',
  '/api/v1/events/',
  '/api/v1/tournaments/',
  '/api/v1/global-persons',
  '/api/v1/clubs',
  '/api/v1/leagues',
];

const ALLOWLIST = [
  '/api/v1/auth/',
  '/api/v1/health',
  '/api/v1/public/',
  // Reading public event-listings without auth must still work
  '/api/v1/events?',
];

/**
 * Lockdown interceptor: when the `admin_lockdown` flag is enabled, any
 * authenticated request to a protected MyClash surface from a non-super-admin
 * user is rejected with HTTP 503. Super admins and unauthenticated public
 * requests pass through unaffected.
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
    if (!PROTECTED_PREFIXES.some((p) => path.startsWith(p))) return next.handle();

    const token = this.extractToken(req);
    if (!token) return next.handle();

    const lockdownOn = await this.flags.isEnabled('admin_lockdown');
    if (!lockdownOn) return next.handle();

    const userId = await this.resolveUserId(token);
    if (!userId) return next.handle();

    const isSuperAdmin = await this.isSuperAdmin(userId);
    if (isSuperAdmin) return next.handle();

    throw new ServiceUnavailableException(
      'MyClash admin is temporarily restricted to super admins. Please try again later.',
    );
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

  private async isSuperAdmin(userId: string): Promise<boolean> {
    try {
      const { data } = await this.supabase.service
        .from('platform_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .maybeSingle();
      return !!data;
    } catch {
      return false;
    }
  }
}
