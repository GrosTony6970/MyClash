import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { GuestJwtService } from '../../modules/auth/guest-jwt.service';
import { StaffJwtService } from '../../modules/staff/staff-jwt.service';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import { ANONYMOUS, type Identity } from './identity';
import { IS_PUBLIC_KEY } from './public.decorator';

export type AuthGuardMode = 'shadow' | 'enforce';

const GUEST_COOKIE = 'mc_guest';
const STAFF_COOKIE = 'mc_staff';

type CookieBag = { cookies?: Record<string, string> };

/**
 * Authenticates every request. A route without @Public() requires an identity.
 *
 * WHY THIS EXISTS: this app had no global authentication. `app.module.ts`
 * registered only ThrottlerGuard (rate limit) and EventReadOnlyGuard (archived
 * events); neither checks who is calling. So every route was public unless it
 * remembered not to be, and 8 controllers forgot — leaving 33 unauthenticated
 * mutating routes, including DELETE /registrations/:id and
 * DELETE /events/:eventId/programme/full. This guard inverts the default so
 * that forgetting fails closed.
 *
 * SCOPE: authentication only. Authorization (org roles) stays in the service
 * layer behind assertOrgRole — org ids come from DB rows, not the request, so
 * they cannot be expressed here. A 200 from this guard means "we know who you
 * are", never "you may do this".
 *
 * VERIFICATION IS LOCAL (signature-only), not a GoTrue round-trip: this runs on
 * all ~573 routes. See SupabaseService.verifyAccessTokenLocal for the bounded
 * trade-off (revocation is not seen for <=1h). Guest and staff tokens already
 * verify locally, so no identity type costs I/O, and an anonymous caller
 * carries no token and costs nothing at all.
 *
 * STATIC SCOPE IS LOAD-BEARING: this guard and its entire transitive dependency
 * tree must stay default-scoped. Nest appends request-scoped global guards
 * AFTER every static one (GuardsContextCreator: `globalGuards.concat(scoped)`),
 * which would silently move this behind EventReadOnlyGuard and re-instantiate
 * it per request across every route. Never inject a Scope.REQUEST provider here,
 * never mark a dependency @Optional() (undefined deps fail open), and always
 * value-import injected services (`import type` erases the DI metadata).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
    private readonly guestJwt: GuestJwtService,
    private readonly staffJwt: StaffJwtService,
    private readonly config: ConfigService,
  ) {}

  private get mode(): AuthGuardMode {
    return this.config.get<string>('AUTH_GUARD_MODE') === 'enforce' ? 'enforce' : 'shadow';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // Resolve identity ALWAYS — before the @Public() check, never after.
    // @Public() gates only the throw, so `identity` is a total function on every
    // request. Short-circuiting here would leave it undefined on the highest
    // traffic routes (GET /me, GET /events, the feature-flag poll) and would let
    // a later `identity ?? anonymous` coalesce quietly reinstate fail-open.
    const identity = this.resolve(request);
    this.attach(request, identity);

    if (identity.kind !== 'anonymous') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (this.mode === 'enforce') {
      throw new UnauthorizedException('Authentication required');
    }

    // Shadow: report, never block. Logged per route so the counts can be split
    // by route class — the routes that already 401/403 today are not
    // regressions, and lumping them together inflates the flip decision.
    this.logger.warn(
      `auth-shadow would-401 ${request.method} ${this.routeOf(context)} reason=${this.reasonOf(request)}`,
    );
    return true;
  }

  /** First identity that verifies wins; claimed outranks guest outranks staff. */
  private resolve(request: FastifyRequest): Identity {
    const claimed = this.resolveClaimed(request);
    if (claimed) return claimed;

    const cookies = (request as FastifyRequest & CookieBag).cookies;

    const guestToken = cookies?.[GUEST_COOKIE];
    if (guestToken) {
      try {
        const payload = this.guestJwt.verify(guestToken);
        return {
          kind: 'guest',
          guestSessionId: payload.sub,
          personId: payload.person_id,
          eventId: payload.event_id,
        };
      } catch {
        // Expired or forged guest cookie — fall through to the next mechanism.
      }
    }

    const staffToken = cookies?.[STAFF_COOKIE];
    if (staffToken) {
      try {
        const payload = this.staffJwt.verify(staffToken);
        return { kind: 'staff', staffId: payload.sub, eventId: payload.event_id };
      } catch {
        // Expired or forged staff cookie — fall through to anonymous.
      }
    }

    return ANONYMOUS;
  }

  private resolveClaimed(request: FastifyRequest): Identity | null {
    const token = this.extractBearer(request);
    if (!token) return null;
    const user = this.supabase.verifyAccessTokenLocal(token);
    if (!user) return null;
    return { kind: 'claimed', userId: user.id, email: user.email ?? null };
  }

  private extractBearer(request: FastifyRequest): string | null {
    const authHeader = request.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return (request as FastifyRequest & CookieBag).cookies?.['sb-access-token'] ?? null;
  }

  /**
   * Write to the wrapper AND to `.raw`: guards get the FastifyRequest wrapper,
   * but RequestLoggingMiddleware reads `req.raw`, so a wrapper-only write is
   * invisible to it and actorId would silently never appear in request logs.
   */
  private attach(request: FastifyRequest, identity: Identity): void {
    (request as FastifyRequest & { identity?: Identity }).identity = identity;
    const raw = (request as FastifyRequest & { raw?: { identity?: Identity } }).raw;
    if (raw) raw.identity = identity;
  }

  /** Distinguishes "never presented a token" from "presented a dead one". */
  private reasonOf(request: FastifyRequest): string {
    return this.extractBearer(request) ? 'invalid_or_expired_token' : 'no_token';
  }

  private routeOf(context: ExecutionContext): string {
    return `${context.getClass().name}.${context.getHandler().name}`;
  }
}
