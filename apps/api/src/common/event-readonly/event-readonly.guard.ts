import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import { ALLOW_ON_ARCHIVED_EVENT_KEY } from './allow-on-archived.decorator';

const READ_VERBS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class EventReadOnlyGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // (1) Skip read-only verbs
    if (READ_VERBS.has(request.method.toUpperCase())) return true;

    // (2) Skip if the handler/controller opts out
    const isAllowed = this.reflector.getAllAndOverride<boolean>(ALLOW_ON_ARCHIVED_EVENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isAllowed) return true;

    // (3) Resolve event id from the request
    const eventId = await this.resolveEventId(request);

    // (4) No event-scoped route — pass through
    if (!eventId) return true;

    // (5) Fetch the event status
    const { data: event } = await this.supabase.service
      .from('events')
      .select('status')
      .eq('id', eventId)
      .maybeSingle();

    // (6) Event not found — let the downstream handler return its own 404
    if (!event) return true;

    // (7) Block archived events
    if ((event as { status: string }).status === 'archived') {
      throw new ForbiddenException(
        'This event is archived and read-only. Only deletion requests are allowed.',
      );
    }

    // (8) Allow
    return true;
  }

  private async resolveEventId(request: FastifyRequest): Promise<string | null> {
    const params = (request.params ?? {}) as Record<string, string>;
    const body = (request.body ?? {}) as Record<string, unknown>;

    // (a) Direct eventId route param
    if (params['eventId']) return params['eventId'];

    // (a′) `/events/<uuid>` anywhere in the path.
    //
    // The event's OWN mutating routes name the param `:id`, not `:eventId` —
    // PATCH events/:id, POST events/:id/publish, /unpublish, /logo, /hero. A
    // params-only lookup resolved nothing for any of them, so the guard fell
    // through to "not event-scoped" and an ARCHIVED event stayed fully
    // editable: rename it, re-slug it, publish it again. Nothing threw.
    //
    // Read off the path rather than off `params['id']`: `:id` means a different
    // entity on most other controllers (tournaments, clubs, deletion requests),
    // and matching the path segment cannot be broken by a param rename either.
    const fromPath = /(?:^|\/)events\/([0-9a-fA-F-]{36})(?:[/?]|$)/.exec(request.url ?? '');
    if (fromPath) return fromPath[1] as string;

    // (b) tournamentId → tournaments.event_id
    if (params['tournamentId']) {
      const { data } = await this.supabase.service
        .from('tournaments')
        .select('event_id')
        .eq('id', params['tournamentId'])
        .maybeSingle();
      const eventId = (data as { event_id?: string } | null)?.event_id;
      if (eventId) return eventId;
    }

    // (c) phaseId → phases.tournament_id → tournaments.event_id
    if (params['phaseId']) {
      const { data: phase } = await this.supabase.service
        .from('phases')
        .select('tournament_id')
        .eq('id', params['phaseId'])
        .maybeSingle();
      const tournamentId = (phase as { tournament_id?: string } | null)?.tournament_id;
      if (tournamentId) {
        const { data: tournament } = await this.supabase.service
          .from('tournaments')
          .select('event_id')
          .eq('id', tournamentId)
          .maybeSingle();
        const eventId = (tournament as { event_id?: string } | null)?.event_id;
        if (eventId) return eventId;
      }
    }

    // (d) poolId → pools.phase_id → phases.tournament_id → tournaments.event_id
    if (params['poolId']) {
      const { data: pool } = await this.supabase.service
        .from('pools')
        .select('phase_id')
        .eq('id', params['poolId'])
        .maybeSingle();
      const phaseId = (pool as { phase_id?: string } | null)?.phase_id;
      if (phaseId) {
        const { data: phase } = await this.supabase.service
          .from('phases')
          .select('tournament_id')
          .eq('id', phaseId)
          .maybeSingle();
        const tournamentId = (phase as { tournament_id?: string } | null)?.tournament_id;
        if (tournamentId) {
          const { data: tournament } = await this.supabase.service
            .from('tournaments')
            .select('event_id')
            .eq('id', tournamentId)
            .maybeSingle();
          const eventId = (tournament as { event_id?: string } | null)?.event_id;
          if (eventId) return eventId;
        }
      }
    }

    // (e) matchId → matches.phase_id → phases.tournament_id → tournaments.event_id
    if (params['matchId']) {
      const { data: match } = await this.supabase.service
        .from('matches')
        .select('phase_id')
        .eq('id', params['matchId'])
        .maybeSingle();
      const phaseId = (match as { phase_id?: string } | null)?.phase_id;
      if (phaseId) {
        const { data: phase } = await this.supabase.service
          .from('phases')
          .select('tournament_id')
          .eq('id', phaseId)
          .maybeSingle();
        const tournamentId = (phase as { tournament_id?: string } | null)?.tournament_id;
        if (tournamentId) {
          const { data: tournament } = await this.supabase.service
            .from('tournaments')
            .select('event_id')
            .eq('id', tournamentId)
            .maybeSingle();
          const eventId = (tournament as { event_id?: string } | null)?.event_id;
          if (eventId) return eventId;
        }
      }
    }

    // (f) registrationId → registrations.tournament_id → tournaments.event_id
    //
    // `registrations` has NO event_id — it is scoped by tournament (0001). The
    // old one-hop read 400'd, the error is swallowed here by design, and the
    // guard then fell through to "no event" — so every registration-addressed
    // route stayed WRITEABLE on an archived event. Same two-hop shape as (d).
    if (params['registrationId']) {
      const { data: registration } = await this.supabase.service
        .from('registrations')
        .select('tournament_id')
        .eq('id', params['registrationId'])
        .maybeSingle();
      const tournamentId = (registration as { tournament_id?: string } | null)?.tournament_id;
      if (tournamentId) {
        const { data: tournament } = await this.supabase.service
          .from('tournaments')
          .select('event_id')
          .eq('id', tournamentId)
          .maybeSingle();
        const eventId = (tournament as { event_id?: string } | null)?.event_id;
        if (eventId) return eventId;
      }
    }

    // (g) body.eventId fallback
    if (typeof body['eventId'] === 'string' && body['eventId']) {
      return body['eventId'];
    }

    return null;
  }
}
