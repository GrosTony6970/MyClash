/**
 * me-people.controller.ts — People hub enrichment
 *
 * GET /me/people/context?globalPersonIds=a,b,c — live tournament context for a
 *     set of global persons (Search-tab cards). Follow state is viewer-scoped;
 *     works anonymously (isFollowing=false) so it never blocks search.
 * GET /me/following — the caller's persistent follows (directory_follows),
 *     each enriched + with the event-follow that backs its notify toggles.
 */
import { Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { FollowsService } from '../follows/follows.service';
import { PeopleContextService } from './people-context.service';

const MAX_CONTEXT_IDS = 60;

@ApiTags('people-context')
@Controller()
export class MePeopleController {
  constructor(
    private readonly peopleContext: PeopleContextService,
    private readonly follows: FollowsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('me/people/context')
  @ApiOperation({ summary: 'Live tournament context for a set of global persons' })
  @ApiQuery({ name: 'globalPersonIds', required: true, description: 'Comma-separated UUIDs' })
  async context(@Query('globalPersonIds') raw: string | undefined, @Req() req: FastifyRequest) {
    const ids = (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_CONTEXT_IDS);
    if (ids.length === 0) return [];
    const userId = await this.resolveOptionalUserId(req);
    return this.peopleContext.enrich(ids, userId);
  }

  @Get('me/following')
  @ApiOperation({ summary: 'The persistent people the caller follows, enriched' })
  async following(@Req() req: FastifyRequest) {
    const userId = await this.resolveUserId(req);
    const directoryFollows = await this.follows.listDirectoryFollows(userId);
    const ids = directoryFollows.map((f) => f.globalPersonId);
    if (ids.length === 0) return [];

    const [contexts, eventState] = await Promise.all([
      this.peopleContext.enrich(ids, userId),
      this.follows.getEventFollowStateForGlobalPersons(userId, ids),
    ]);
    const contextById = new Map(contexts.map((c) => [c.globalPersonId, c]));

    // Preserve the directory-follow order (newest first).
    return directoryFollows
      .map((f) => {
        const ctx = contextById.get(f.globalPersonId);
        if (!ctx) return null;
        return {
          ...ctx,
          followedAt: f.followedAt,
          eventFollow: eventState.get(f.globalPersonId) ?? null,
        };
      })
      .filter(Boolean);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private tokenFrom(req: FastifyRequest): string | null {
    const authHeader = req.headers['authorization'];
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    return authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (cookies?.['sb-access-token'] ?? null);
  }

  private async resolveUserId(req: FastifyRequest): Promise<string> {
    const token = this.tokenFrom(req);
    if (!token) throw new UnauthorizedException('Authentication required');
    const user = await this.supabase.getAuthUser(token);
    if (!user) throw new UnauthorizedException('Invalid token');
    return user.id;
  }

  private async resolveOptionalUserId(req: FastifyRequest): Promise<string | null> {
    const token = this.tokenFrom(req);
    if (!token) return null;
    const user = await this.supabase.getAuthUser(token);
    return user?.id ?? null;
  }
}
