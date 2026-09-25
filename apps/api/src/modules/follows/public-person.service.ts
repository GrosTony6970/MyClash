/**
 * The public person page's header (operator ruling 121a): one Event's person as the public sees
 * them — name, club, roles, whether they accept followers and whether the viewer follows them.
 *
 * The bar is the person schedule's (`PublicScheduleService.getPublicSchedule`): the Event must be
 * one the caller may see, and the person must be in THAT Event. A hidden Event answers exactly as
 * an unknown Event, and a person of another Event exactly as an unknown person.
 *
 * It lives in the follows module because it asks FollowsService; persons → follows would be a
 * cycle, since follows already imports persons.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CompetitionEvent,
  type PublicReader,
  visibleTournaments,
} from '../../common/auth/competition-visibility';
import { assertCanReadEventRow, eventNotFound } from '../../common/auth/event-read-gate';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrivacyService } from '../persons/privacy.service';
import { SupabaseService } from '../supabase/supabase.service';
import { type FollowIdentity, FollowsService } from './follows.service';

export type PublicPersonRole = 'competitor' | 'referee' | 'instructor';

export interface PublicPersonProfile {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
  roles: PublicPersonRole[];
  allowBeingFollowed: boolean;
  followState: 'following' | 'not_following';
}

interface PersonRow {
  id: string;
  given_name: string;
  family_name: string;
  global_person_id: string | null;
  clubs: { name: string } | null;
}

/** The entries the public roster lists (`listPublicParticipants`): withdrawn ones are not. */
const ENTERED_STATUSES = ['registered', 'checked_in', 'waitlist'];

@Injectable()
export class PublicPersonService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly privacy: PrivacyService,
    private readonly follows: FollowsService,
  ) {}

  /**
   * Both checks come before any read of the person's details. Who the viewer follows as is asked
   * last: it costs a sign-in lookup, and a refused request needs none.
   */
  async getProfile(
    eventId: string,
    personId: string,
    reader: PublicReader,
    resolveFollower: () => Promise<FollowIdentity>,
  ): Promise<PublicPersonProfile> {
    const event = await this.readEvent(eventId);
    if (!event) throw eventNotFound(eventId);
    await assertCanReadEventRow(this.deps(), eventId, event, () => Promise.resolve(reader.userId));
    const person = await this.readPerson(eventId, personId);

    const [roles, privacy, following] = await Promise.all([
      this.rolesOf(event, person, reader),
      this.privacy.getOrCreate(person.id),
      resolveFollower().then((identity) => this.follows.isFollowing(eventId, person.id, identity)),
    ]);
    return {
      id: person.id,
      givenName: person.given_name,
      familyName: person.family_name,
      clubLabel: person.clubs?.name ?? null,
      roles,
      allowBeingFollowed: privacy.allowBeingFollowed,
      followState: following ? 'following' : 'not_following',
    };
  }

  private deps() {
    return { supabase: this.supabase, orgs: this.orgs };
  }

  private async readEvent(eventId: string): Promise<CompetitionEvent | null> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, status, organization_id, event_kind')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(`event read failed: ${error.message}`);
    return data as CompetitionEvent | null;
  }

  private async readPerson(eventId: string, personId: string): Promise<PersonRow> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, global_person_id, clubs(name)')
      .eq('id', personId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new Error(`person read failed: ${error.message}`);
    if (!data) throw new NotFoundException(`Person "${personId}" not found`);
    return data as unknown as PersonRow;
  }

  /** The roles the public roster shows: an entry in a Tournament the caller may see, a referee, an instructor. */
  private async rolesOf(
    event: CompetitionEvent,
    person: PersonRow,
    reader: PublicReader,
  ): Promise<PublicPersonRole[]> {
    const [competes, referees, teaches] = await Promise.all([
      this.competes(event, person.id, reader),
      this.refereesAt(event.id, person.global_person_id),
      this.teachesAt(event.id, person.global_person_id),
    ]);
    const roles: PublicPersonRole[] = [];
    if (competes) roles.push('competitor');
    if (referees) roles.push('referee');
    if (teaches) roles.push('instructor');
    return roles;
  }

  /** An entry in a draft Tournament is no role for an outsider (ruling 127a). */
  private async competes(
    event: CompetitionEvent,
    personId: string,
    reader: PublicReader,
  ): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, status')
      .eq('event_id', event.id);
    if (error) throw new Error(`tournaments read failed: ${error.message}`);
    const visible = await visibleTournaments(
      this.deps(),
      event,
      (data ?? []) as Array<{ id: string; status: string }>,
      reader,
    );
    if (visible.length === 0) return false;
    const { data: entries, error: entryError } = await this.supabase.service
      .from('registrations')
      .select('id')
      .eq('person_id', personId)
      .in(
        'tournament_id',
        visible.map((tournament) => tournament.id),
      )
      .in('status', ENTERED_STATUSES)
      .limit(1);
    if (entryError) throw new Error(`registrations read failed: ${entryError.message}`);
    return (entries ?? []).length > 0;
  }

  /** `event_referees.person_id` is the GLOBAL person, as the roster reads it. */
  private async refereesAt(eventId: string, globalPersonId: string | null): Promise<boolean> {
    if (!globalPersonId) return false;
    const { data, error } = await this.supabase.service
      .from('event_referees')
      .select('person_id')
      .eq('event_id', eventId)
      .eq('person_id', globalPersonId)
      .maybeSingle();
    if (error) throw new Error(`event referees read failed: ${error.message}`);
    return data !== null;
  }

  /** `event_instructors.person_id` is the GLOBAL person, as the roster reads it. */
  private async teachesAt(eventId: string, globalPersonId: string | null): Promise<boolean> {
    if (!globalPersonId) return false;
    const { data, error } = await this.supabase.service
      .from('event_instructors')
      .select('person_id')
      .eq('event_id', eventId)
      .eq('person_id', globalPersonId)
      .maybeSingle();
    if (error) throw new Error(`event instructors read failed: ${error.message}`);
    return data !== null;
  }
}
