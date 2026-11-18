import {
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { hashAgentKey, isAgentKey } from './agent-key';

const STAMP_EVERY_MS = 5 * 60_000;

type AgentKeyRow = { id: string; revoked_at: string | null; last_used_at: string | null };

/**
 * The one place an ops agent key is accepted (the ops agent's design, section 1).
 *
 * It reads the `Authorization: Bearer` header only. A cookie is never read: a super admin's
 * browser carries a login cookie, and the door must not take it for the key. Every other reader
 * of the bearer in the API sends it to the local login check or to GoTrue, and both refuse a key
 * that is not a login, so outside the door the key is what a stranger with an expired login sends.
 * `agent-door.wall.test.ts` holds that this guard is the only code that turns a key into a caller.
 */
@Injectable()
export class AgentKeyGuard implements CanActivate {
  private readonly logger = new Logger(AgentKeyGuard.name);

  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const key = bearerOf(request);
    if (!key || !isAgentKey(key)) throw new UnauthorizedException('Agent key required');

    const { data, error } = await this.supabase.service
      .from('agent_keys')
      .select('id, revoked_at, last_used_at')
      .eq('token_hash', hashAgentKey(key))
      .maybeSingle();
    if (error) {
      this.logger.error(`agent key lookup failed: ${error.message}`);
      throw new UnauthorizedException('Agent key required');
    }
    const row = data as AgentKeyRow | null;
    if (!row || row.revoked_at) throw new UnauthorizedException('Agent key required');

    this.stamp(row);
    return true;
  }

  /**
   * Records when the key was last used, at most once per five minutes, without delaying the
   * answer. Two requests may both write it; the last writer wins, which is harmless.
   */
  private stamp(row: AgentKeyRow): void {
    if (row.last_used_at && Date.now() - Date.parse(row.last_used_at) < STAMP_EVERY_MS) return;
    void Promise.resolve(
      this.supabase.service
        .from('agent_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', row.id),
    )
      .then(({ error }) => {
        if (error) this.logger.warn(`agent key last-used stamp failed: ${error.message}`);
      })
      // A client that throws instead of answering must not become an unhandled rejection.
      .catch((err: unknown) =>
        this.logger.warn(`agent key last-used stamp failed: ${String(err)}`),
      );
  }
}

function bearerOf(request: FastifyRequest): string | null {
  const header = request.headers['authorization'];
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
}
