import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import { ALLOW_ON_ARCHIVED_EVENT_KEY } from './allow-on-archived.decorator';
import { BLOCK_ON_COMPLETED_EVENT_KEY } from './block-on-completed.decorator';
import { resolveEventId } from './resolve-event-id';

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

    // (2b) Does this route also refuse on a COMPLETED event? Read before the
    // resolve, because it changes what an unresolvable event means below.
    const blockOnCompleted =
      this.reflector.getAllAndOverride<boolean>(BLOCK_ON_COMPLETED_EVENT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    // (3) Resolve event id from the request
    const eventId = await resolveEventId(this.supabase, request);

    // (4) No event-scoped route — pass through.
    //
    // Right for the archived sweep, which runs on every route in the API and
    // must not refuse the ones that have nothing to do with an event. WRONG for
    // a route somebody deliberately marked as needing protection: a param
    // rename, a new sibling route, or a resolver branch that quietly stops
    // matching would turn the marker into decoration with nothing failing —
    // which is exactly how this file's other two holes lived for months. So a
    // marked route fails CLOSED. The blast radius is only the marked routes,
    // and the failure mode flips from "silently unprotected forever" to
    // "loudly broken on the first request", which is the one that gets fixed.
    if (!eventId) {
      if (blockOnCompleted) {
        throw new ForbiddenException(
          'This route is protected on completed events, but its event could not be resolved. ' +
            'Refusing rather than guessing.',
        );
      }
      return true;
    }

    // (5) Fetch the event status
    const { data: event } = await this.supabase.service
      .from('events')
      .select('status')
      .eq('id', eventId)
      .maybeSingle();

    // (6) Event not found — let the downstream handler return its own 404
    if (!event) return true;

    const status = (event as { status: string }).status;

    // (7) Block archived events
    if (status === 'archived') {
      throw new ForbiddenException(
        'This event is archived and read-only. Only deletion requests are allowed.',
      );
    }

    // (7b) Block destructive plan changes once the event is completed. Re-timing
    // a finished event to tidy the record stays allowed; regenerating or
    // deleting its structure does not.
    if (blockOnCompleted && status === 'completed') {
      throw new ForbiddenException(
        'This event is completed. Re-open it before regenerating or deleting its plan.',
      );
    }

    // (8) Allow
    return true;
  }
}
