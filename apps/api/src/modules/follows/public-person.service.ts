/**
 * The public person page's header (operator ruling 121a): one Event's person as the public sees
 * them — name, club, roles, whether they accept followers and whether the viewer follows them.
 *
 * The bar is `readEventPerson`'s, shared with the schedule, a follow and the guest sign-in: the Event must be
 * one the caller may see, and the person must be in THAT Event and not entered only in
 * Tournaments hidden from the caller (rulings 129, 167, 168).
 *
 * It lives in the follows module because it asks FollowsService; persons → follows would be a
 * cycle, since follows already imports persons.
 */
import { Injectable } from '@nestjs/common';
import { type CompetitionEvent, type PublicReader } from '../../common/auth/competition-visibility';
import { publicRolesOf, type PublicPersonRole } from '../persons/public-person-roles';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrivacyService } from '../persons/privacy.service';
import { SupabaseService } from '../supabase/supabase.service';
import { readEventPerson } from '../../common/auth/event-person-gate';
import { type FollowIdentity, FollowsService } from './follows.service';

export type { PublicPersonRole };

export interface PublicPersonProfile {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
  roles: PublicPersonRole[];
  allowBeingFollowed: boolean;
  followState: 'following' | 'not_following';
  /**
   * An account holds this roster name (operator ruling 269): such a name is not a guest's
   * to pick, so the page offers "Sign in" there. Never which account. The guest door
   * already answers the same fact to anybody who asks it (`PERSON_HAS_ACCOUNT`).
   */
  hasAccount: boolean;
}

interface PersonRow {
  id: string;
  given_name: string;
  family_name: string;
  global_person_id: string | null;
  claimed_by_user_id: string | null;
  clubs: { name: string } | null;
}

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
    const { event, person } = await readEventPerson<PersonRow>(
      this.deps(),
      eventId,
      personId,
      reader,
      'id, given_name, family_name, global_person_id, claimed_by_user_id, clubs(name)',
    );

    const [roles, privacy, following] = await Promise.all([
      this.rolesOf(event, person, reader),
      this.privacy.forGlobalPerson(person.global_person_id),
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
      hasAccount: Boolean(person.claimed_by_user_id),
    };
  }

  private deps() {
    return { supabase: this.supabase, orgs: this.orgs };
  }

  /** The roles the public roster shows (`publicRolesOf`, the one owner the People search asks too). */
  private async rolesOf(
    event: CompetitionEvent,
    person: PersonRow,
    reader: PublicReader,
  ): Promise<PublicPersonRole[]> {
    const roles = await publicRolesOf(this.deps(), event, [person], reader);
    return roles.get(person.id) ?? [];
  }
}
