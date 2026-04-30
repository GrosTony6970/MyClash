import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * Guard that allows only super admins.
 *
 * Checks:
 * 1. A valid Supabase JWT is present (Authorization header or sb-access-token cookie).
 * 2. The user has a row in `platform_roles` with `role = 'super_admin'`.
 *
 * Pre-T-101: if the platform_roles table doesn't exist yet, the guard falls
 * back to checking the JWT `role` claim directly (useful for bootstrapping).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Authentication required');

    const {
      data: { user },
      error,
    } = await this.supabase.anon.auth.getUser(token);
    if (error || !user) throw new UnauthorizedException('Invalid or expired token');

    // Check platform_roles table (graceful fallback pre-T-101)
    try {
      const { data } = await this.supabase.service
        .from('platform_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'super_admin')
        .maybeSingle();

      if (data) return true;
    } catch {
      // Table not yet created — fall through to JWT claim check
    }

    // Fallback: check JWT app_metadata.role claim (set during bootstrap)
    const role = user.app_metadata?.['role'] as string | undefined;
    if (role === 'super_admin') return true;

    throw new ForbiddenException('Super admin access required');
  }

  private extractToken(request: FastifyRequest): string | null {
    const auth = request.headers['authorization'];
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    return cookies?.['sb-access-token'] ?? null;
  }
}
