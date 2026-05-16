import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../../supabase/supabase.service';

type GoTrueAuthUser = {
  id: string;
  app_metadata?: Record<string, unknown>;
};

function isAuthUser(value: unknown): value is GoTrueAuthUser {
  return Boolean(
    value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string',
  );
}

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
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Authentication required');

    const user = await this.requestAuthUser(token);
    if (!user) throw new UnauthorizedException('Invalid or expired token');

    // Check platform_roles table (graceful fallback pre-T-101)
    try {
      const { data } = await this.supabase.service
        .from('platform_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'super_admin')
        .maybeSingle();

      if (data) {
        (request as FastifyRequest & { actorUserId?: string }).actorUserId = user.id;
        return true;
      }
    } catch {
      // Table not yet created — fall through to JWT claim check
    }

    // Fallback: check JWT app_metadata.role claim (set during bootstrap)
    const role = user.app_metadata?.['role'] as string | undefined;
    if (role === 'super_admin') {
      (request as FastifyRequest & { actorUserId?: string }).actorUserId = user.id;
      return true;
    }

    throw new ForbiddenException('Super admin access required');
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
