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

const ALLOWLIST = ['/api/v1/auth/', '/api/v1/health', '/api/v1/public/'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Read-only interceptor: when the `read_only_mode` flag is enabled, every
 * non-GET request to the API is rejected with 503 — except for super-admin
 * users and the standard public/auth allowlist. Lighter than
 * `admin_lockdown`: organisers can still browse, they just can't write.
 */
@Injectable()
export class ReadOnlyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ReadOnlyInterceptor.name);

  constructor(
    private readonly flags: AdminFeatureFlagsService,
    private readonly supabase: SupabaseService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const method = (req.method ?? 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) return next.handle();

    const path: string = (req.url ?? '').toString();
    if (ALLOWLIST.some((p) => path.startsWith(p))) return next.handle();

    const readOnly = await this.flags.isEnabled('read_only_mode');
    if (!readOnly) return next.handle();

    const token = this.extractToken(req);
    if (token) {
      const userId = await this.resolveUserId(token);
      if (userId && (await this.isSuperAdmin(userId))) return next.handle();
    }

    throw new ServiceUnavailableException('Platform is in read-only mode');
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
      this.logger.warn(`Failed to resolve user during read-only check: ${String(err)}`);
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
