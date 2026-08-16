/**
 * "Which event does this request touch?", answered off the URL and params.
 *
 * Its own module because two guards ask it now — the archived check and the
 * completed-event block — and because this logic has failed OPEN twice. Both
 * post-mortems are still in the branch comments below, and they share a shape:
 * a branch keyed on a param name that no route actually binds matches nothing,
 * the resolver returns null, and the caller reads that as "not event-scoped"
 * and waves the write through. Nothing errors. One owner makes the next such
 * hole a one-line fix in one place instead of two.
 *
 * Returns null when the request genuinely is not event-scoped. Callers decide
 * what null means: passing is right for the archived sweep, which runs on every
 * route in the API, and wrong for a route explicitly marked as needing
 * protection.
 */
import type { FastifyRequest } from 'fastify';
import type { SupabaseService } from '../../modules/supabase/supabase.service';

export async function resolveEventId(
  supabase: SupabaseService,
  request: FastifyRequest,
): Promise<string | null> {
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
  const url = request.url ?? '';
  const fromPath = /(?:^|\/)events\/([0-9a-fA-F-]{36})(?:[/?]|$)/.exec(url);
  if (fromPath) return fromPath[1] as string;

  // (a″) `/matches/<uuid>` — same defect, same fix. Every match route names
  // its param `:id`, so the params-only `matchId` branch this replaces
  // matched NO route in the API and the guard fell through to "not
  // event-scoped": PATCH matches/:id/schedule re-timed bouts on an ARCHIVED
  // event, and nothing threw.
  //
  // One query, not the three that branch walked: the embedded select is the
  // shape `event-authz.orgIdForPool` already uses. `match-forfeits/<uuid>`
  // does not match — the segment has to be exactly `matches`.
  const fromMatch = /(?:^|\/)matches\/([0-9a-fA-F-]{36})(?:[/?]|$)/.exec(url);
  if (fromMatch) {
    const { data } = await supabase.service
      .from('matches')
      .select('phases!inner(tournaments!inner(event_id))')
      .eq('id', fromMatch[1] as string)
      .maybeSingle();
    const eventId = (data as { phases?: { tournaments?: { event_id?: string } } } | null)?.phases
      ?.tournaments?.event_id;
    if (eventId) return eventId;
  }

  // (a‴) `/lices/<uuid>` — PATCH and DELETE both live here, and deleting a
  // piste is ON DELETE SET NULL on matches.lice_id, i.e. it unschedules every
  // match on that strip. `lices.event_id` is required, so the hop is single.
  const fromLice = /(?:^|\/)lices\/([0-9a-fA-F-]{36})(?:[/?]|$)/.exec(url);
  if (fromLice) {
    const { data } = await supabase.service
      .from('lices')
      .select('event_id')
      .eq('id', fromLice[1] as string)
      .maybeSingle();
    const eventId = (data as { event_id?: string } | null)?.event_id;
    if (eventId) return eventId;
  }

  // (a⁗) `/swiss-rounds/<uuid>` — DELETE swiss-rounds/:roundId/referee-assignments
  // clears a whole Swiss round's crew. No branch reached it: the param is named
  // `roundId`, which nothing else here looks for, so the route resolved to null
  // and was never event-scoped for ANY status check. Two hops, same shape as (c).
  const fromSwissRound = /(?:^|\/)swiss-rounds\/([0-9a-fA-F-]{36})(?:[/?]|$)/.exec(url);
  if (fromSwissRound) {
    const { data: round } = await supabase.service
      .from('swiss_rounds')
      .select('phases!inner(tournaments!inner(event_id))')
      .eq('id', fromSwissRound[1] as string)
      .maybeSingle();
    const eventId = (round as { phases?: { tournaments?: { event_id?: string } } } | null)?.phases
      ?.tournaments?.event_id;
    if (eventId) return eventId;
  }

  // (a⁵) `/referee-assignments/<uuid>` — the row carries `event_id` itself, so
  // this is the one single-hop lookup here.
  const fromAssignment = /(?:^|\/)referee-assignments\/([0-9a-fA-F-]{36})(?:[/?]|$)/.exec(url);
  if (fromAssignment) {
    const { data: assignment } = await supabase.service
      .from('referee_assignments')
      .select('event_id')
      .eq('id', fromAssignment[1] as string)
      .maybeSingle();
    const eventId = (assignment as { event_id?: string } | null)?.event_id;
    if (eventId) return eventId;
  }

  // (b) tournamentId → tournaments.event_id
  if (params['tournamentId']) {
    const { data } = await supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', params['tournamentId'])
      .maybeSingle();
    const eventId = (data as { event_id?: string } | null)?.event_id;
    if (eventId) return eventId;
  }

  // (c) phaseId → phases.tournament_id → tournaments.event_id
  if (params['phaseId']) {
    const { data: phase } = await supabase.service
      .from('phases')
      .select('tournament_id')
      .eq('id', params['phaseId'])
      .maybeSingle();
    const tournamentId = (phase as { tournament_id?: string } | null)?.tournament_id;
    if (tournamentId) {
      const { data: tournament } = await supabase.service
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
    const { data: pool } = await supabase.service
      .from('pools')
      .select('phase_id')
      .eq('id', params['poolId'])
      .maybeSingle();
    const phaseId = (pool as { phase_id?: string } | null)?.phase_id;
    if (phaseId) {
      const { data: phase } = await supabase.service
        .from('phases')
        .select('tournament_id')
        .eq('id', phaseId)
        .maybeSingle();
      const tournamentId = (phase as { tournament_id?: string } | null)?.tournament_id;
      if (tournamentId) {
        const { data: tournament } = await supabase.service
          .from('tournaments')
          .select('event_id')
          .eq('id', tournamentId)
          .maybeSingle();
        const eventId = (tournament as { event_id?: string } | null)?.event_id;
        if (eventId) return eventId;
      }
    }
  }

  // (e) — REMOVED. It read `params['matchId']`, which no mutating route in
  // this API binds: they are all `matches/:id`. The one exception,
  // PATCH matches/:matchId/swiss-sides, has a URL that (a″) matches, and
  // gear.controller's GET match/:matchId never reaches here (read verbs skip
  // at the top). So the branch was dead code guarding nothing, and (a″)
  // covers every URL it could ever have covered — in one query instead of
  // three. A spec pins swiss-sides so the removal cannot silently regress.

  // (f) registrationId → registrations.tournament_id → tournaments.event_id
  //
  // `registrations` has NO event_id — it is scoped by tournament (0001). The
  // old one-hop read 400'd, the error is swallowed here by design, and the
  // guard then fell through to "no event" — so every registration-addressed
  // route stayed WRITEABLE on an archived event. Same two-hop shape as (d).
  if (params['registrationId']) {
    const { data: registration } = await supabase.service
      .from('registrations')
      .select('tournament_id')
      .eq('id', params['registrationId'])
      .maybeSingle();
    const tournamentId = (registration as { tournament_id?: string } | null)?.tournament_id;
    if (tournamentId) {
      const { data: tournament } = await supabase.service
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
