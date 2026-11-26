import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { AdminFeatureFlagsService } from '../../modules/admin/admin-feature-flags.service';
import { isAgentKey } from '../../modules/ops-agent/agent-key';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import { hasPlatformTier } from '../auth/platform-role';
import { readOnlyModeRefusal } from '../read-only-mode';

/**
 * `staff-auth/`: a PIN signs in and out of a pad as an account does under `auth/`
 * (operator ruling 336). Not `staff/`: a pad's other saves stay refused.
 *
 * `staff/heartbeat`: the pad's beat is what the Live board reads (operator ruling
 * 339). Refused, the board kept the last numbers it had: a green dot over a pad
 * that held hits.
 *
 * `staff/attention`: a referee's call for a medic, the head referee or a dispute
 * (ruling 952). Maintenance on the server is no reason for it to stay unheard.
 *
 * `auth/` passes whole, for the sign-in. Its doors that make an account or a club
 * refuse on their own (`assertNotReadOnly`, operator ruling 341).
 */
const ALLOWLIST = [
  '/api/v1/auth/',
  '/api/v1/staff-auth/',
  '/api/v1/staff/heartbeat',
  '/api/v1/staff/attention',
  '/api/v1/health',
  '/api/v1/public/',
];

/**
 * The MCP door (operator ruling 985). Every MCP call is a POST, a question included, so the
 * method says nothing here: a referee's "when is my next bout?" was refused for the whole
 * maintenance. The door passes whole; a tool that writes refuses on its own
 * (`assertNotReadOnly`), as `auth/`'s sign-up doors do. The door has no sub-path: only this
 * exact path passes.
 */
const MCP_DOOR = '/api/v1/mcp';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Read-only interceptor: when the `read_only_mode` flag is enabled, every
 * non-GET request to the API is rejected with a 503 coded `read_only_mode` —
 * except for super-admin users, the standard public/auth allowlist, a pad's beat and the MCP door.
 * Organisers can still browse, they just can't write.
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
    if (path.split('?')[0] === MCP_DOOR) return next.handle();

    const readOnly = await this.flags.isEnabled('read_only_mode');
    if (!readOnly) return next.handle();

    const token = this.extractToken(req);
    // An ops agent key is no login and no super admin: it is refused here as it is, and it never
    // goes to the login service (the key leaves its guard as a hash only).
    if (token && !isAgentKey(token)) {
      const userId = await this.resolveUserId(token);
      if (userId && (await this.isSuperAdmin(userId))) return next.handle();
    }

    throw readOnlyModeRefusal();
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

  /**
   * `super_admin`-EXACT, and it stays that way. `read_only_mode` exists to stop
   * every write on the platform; letting a `platform_admin` through would
   * re-open exactly what the switch is for. Note also that the tier named
   * `platform_viewer` is an unrelated concept to this flag despite the
   * proximity of the words — do not "unify" them.
   */
  private async isSuperAdmin(userId: string): Promise<boolean> {
    return hasPlatformTier(this.supabase, userId, 'super_admin');
  }
}
