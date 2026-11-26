import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { TournamentContext } from './tournament-query.types';

export const DEFAULT_RATE_LIMIT = 60;

type TournamentRow = {
  id: string;
  event_id: string;
  name: string;
  weapon?: string | null;
  events?: { organization_id?: string | null } | null;
};

export type QuerySettingsRow = {
  access_policy?: string | null;
  rate_limit_per_hour?: number | null;
};

export function mapQuerySettings(row: QuerySettingsRow | null) {
  return {
    accessPolicy: row?.access_policy ?? 'organizers_only',
    rateLimitPerHour: row?.rate_limit_per_hour ?? DEFAULT_RATE_LIMIT,
  };
}

export async function queryTournamentContext(
  supabase: SupabaseService,
  tournamentId: string,
): Promise<TournamentContext> {
  const { data, error } = await supabase.service
    .from('tournaments')
    .select('id, event_id, name, weapon, events(organization_id)')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
  const row = data as TournamentRow;
  const organizationId = row.events?.organization_id;
  if (!organizationId)
    throw new BadRequestException('Tournament organization could not be resolved');
  return {
    tournamentId: row.id,
    eventId: row.event_id,
    organizationId,
    name: row.name,
    weapon: row.weapon ?? null,
    weapons: row.weapon ? [row.weapon] : [],
    poolNames: [],
    liceNumbers: [],
    divisions: [],
  };
}

export async function readQuerySettings(supabase: SupabaseService, tournamentId: string) {
  const { data, error } = await supabase.service
    .from('tournament_query_settings')
    .select('access_policy, rate_limit_per_hour')
    .eq('tournament_id', tournamentId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  return mapQuerySettings(data as QuerySettingsRow | null);
}

/** A head judge is anyone on the Event's referee list (ruling 987). */
async function isEventReferee(
  supabase: SupabaseService,
  eventId: string,
  userId: string,
): Promise<boolean> {
  const person = await supabase.service
    .from('global_persons')
    .select('id')
    .eq('claimed_by_user_id', userId)
    .maybeSingle();
  if (person.error) throw new Error(person.error.message);
  if (!person.data) return false;
  const listed = await supabase.service
    .from('event_referees')
    .select('person_id')
    .eq('event_id', eventId)
    .eq('person_id', (person.data as { id: string }).id)
    .maybeSingle();
  if (listed.error) throw new Error(listed.error.message);
  return Boolean(listed.data);
}

async function isRosterFighter(
  supabase: SupabaseService,
  eventId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.service
    .from('persons')
    .select('id')
    .eq('event_id', eventId)
    .eq('claimed_by_user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/**
 * The one access check for the tournament query tools. Policies nest: each wider one also admits
 * the narrower readers. Every refusal is a ForbiddenException (or the Unauthorized below); any
 * other throw is a failed read and must not read as a refusal.
 */
export async function assertQueryAccess(
  deps: { supabase: SupabaseService; organizations: OrganizationsService },
  tournament: TournamentContext,
  actorUserId: string,
  settings: { accessPolicy: string },
): Promise<void> {
  if (!actorUserId || actorUserId === 'anonymous') {
    throw new UnauthorizedException('Authentication required');
  }
  const { supabase, organizations } = deps;
  const policy = settings.accessPolicy;
  if (
    policy !== 'organizers_only' &&
    policy !== 'organizers_head_judges' &&
    policy !== 'anyone_with_tournament_access'
  ) {
    throw new ForbiddenException('Query access policy not recognised');
  }
  try {
    await organizations.assertOrgRole(tournament.organizationId, actorUserId, 'admin');
    return;
  } catch (error) {
    if (!(error instanceof ForbiddenException) || policy === 'organizers_only') throw error;
    if (await isEventReferee(supabase, tournament.eventId, actorUserId)) return;
    if (
      policy === 'anyone_with_tournament_access' &&
      (await isRosterFighter(supabase, tournament.eventId, actorUserId))
    ) {
      return;
    }
    throw error;
  }
}
