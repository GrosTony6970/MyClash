import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { canReadEvent, type PublicReader } from '../../common/auth/competition-visibility';
import { eventNotFound } from '../../common/auth/event-read-gate';
import { AuthService } from '../auth/auth.service';
import { personEmailMatchesUser } from '../auth/person-email-match';
import { isReachable, type ReachableRow } from '../fighters/directory-predicate';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { personNameKey } from './duplicate-guard';
import { PersonsService } from './persons.service';

/** Who the join put on the list, and how (rulings 516, 568). */
export interface JoinOutcome {
  personId: string;
  joined: 'new' | 'claimed' | 'already';
}

/** Why the join stops and sends the person to the organiser (ruling 572 and the plan's step 5). */
export type AskOrganiserReason = 'sameName' | 'yourProfile' | 'yourAddress';

interface Account {
  id: string;
  email: string;
}

interface Names {
  givenName: string;
  familyName: string;
}

interface Profile extends Names {
  id: string;
}

interface RosterRow {
  id: string;
  email: string | null;
  given_name: string;
  family_name: string;
  claimed_by_user_id: string | null;
  global_person_id: string | null;
}

const ROSTER_SELECT = 'id, email, given_name, family_name, claimed_by_user_id, global_person_id';

function askOrganiser(reason: AskOrganiserReason): ConflictException {
  return new ConflictException({
    code: 'ASK_ORGANISER',
    reason,
    message: 'Ask the organiser to add you to this Event.',
  });
}

/**
 * An account puts itself on an Event's list, from a Workshop page (rulings 516, 567, 568). The row
 * is made by the organiser's own add and claimed by the claim's own owner, so the duplicate guards,
 * the profile resolution and the profile link are theirs. The address is always the account's.
 */
@Injectable()
export class EventJoinService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auth: AuthService,
    private readonly persons: PersonsService,
    private readonly orgs: OrganizationsService,
  ) {}

  async join(
    eventId: string,
    account: Account,
    reader: PublicReader,
    typed: Partial<Names>,
  ): Promise<JoinOutcome> {
    await this.assertJoinable(eventId, reader);
    const profile = await this.liveProfile(account.id);
    const found = await this.ownRow(eventId, account);
    if (found) return found;
    const names = profile ?? namesTyped(typed);
    await this.refuseLookalike(eventId, profile, names);
    try {
      return await this.create(eventId, account, profile, names);
    } catch (err) {
      // The add refuses an address already on the list (409) and flattens a lost insert race into
      // a 400: a second tap, or the organiser adding this address meanwhile. Look once more; with
      // nothing found, the add's own error stands — a database fault is not "ask the organiser".
      if (!(err instanceof ConflictException || err instanceof BadRequestException)) throw err;
      const again = await this.ownRow(eventId, account);
      if (again) return again;
      await this.refuseLookalike(eventId, profile, names);
      throw err;
    }
  }

  /** Visible to this caller (else unknown), and open to joining. Completed/archived: the guard. */
  private async assertJoinable(eventId: string, reader: PublicReader): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, status, organization_id, event_kind, workshop_self_join')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(`event read failed: ${error.message}`);
    const event = data as {
      id: string;
      status: string;
      organization_id: string;
      event_kind: string | null;
      workshop_self_join: boolean | null;
    } | null;
    const deps = { supabase: this.supabase, orgs: this.orgs };
    if (!event || !(await canReadEvent(deps, event, reader))) throw eventNotFound(eventId);
    if (event.workshop_self_join !== true) {
      throw new ConflictException({
        code: 'SELF_JOIN_CLOSED',
        message: 'People cannot join this Event by themselves.',
      });
    }
  }

  /** The account's live profile (not merged, erased nor deleted): its names win (the plan's 4). */
  private async liveProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id, given_name, family_name, deleted_at, merged_into_id, account_deleted_at')
      .eq('claimed_by_user_id', userId);
    if (error) throw new Error(`profile read failed: ${error.message}`);
    const rows = (data ?? []) as Array<
      ReachableRow & { id: string; given_name: string; family_name: string }
    >;
    const live = rows.find(isReachable);
    return live ? { id: live.id, givenName: live.given_name, familyName: live.family_name } : null;
  }

  private async roster(eventId: string): Promise<RosterRow[]> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select(ROSTER_SELECT)
      .eq('event_id', eventId);
    if (error) throw new Error(`roster read failed: ${error.message}`);
    return (data ?? []) as RosterRow[];
  }

  /** The account's row already (`already`), or an unclaimed one with its address (`claimed`). */
  private async ownRow(eventId: string, account: Account): Promise<JoinOutcome | null> {
    const rows = await this.roster(eventId);
    const held = rows.find((row) => row.claimed_by_user_id === account.id);
    if (held) return { personId: held.id, joined: 'already' };
    const withAddress = rows.filter((row) => personEmailMatchesUser(row.email, account.email));
    const free = withAddress.find((row) => row.claimed_by_user_id === null);
    if (free) return this.claim(account, free.id, 'claimed');
    if (withAddress.length > 0) throw askOrganiser('yourAddress');
    return null;
  }

  /** A row that may be this person, with nothing to prove it: the organiser decides (572). */
  private async refuseLookalike(
    eventId: string,
    profile: Profile | null,
    names: Names,
  ): Promise<void> {
    const rows = await this.roster(eventId);
    if (profile && rows.some((row) => row.global_person_id === profile.id)) {
      throw askOrganiser('yourProfile');
    }
    const key = personNameKey(names.givenName, names.familyName);
    const sameName = rows.some(
      (row) => !row.email && personNameKey(row.given_name, row.family_name) === key,
    );
    if (sameName) throw askOrganiser('sameName');
  }

  private async create(
    eventId: string,
    account: Account,
    profile: Profile | null,
    names: Names,
  ): Promise<JoinOutcome> {
    const created = await this.persons.createPerson(
      eventId,
      {
        givenName: names.givenName,
        familyName: names.familyName,
        email: account.email,
        globalPersonId: profile?.id ?? null,
      },
      account.id,
    );
    return this.claim(account, created.id, 'new');
  }

  private async claim(
    account: Account,
    personId: string,
    joined: 'new' | 'claimed',
  ): Promise<JoinOutcome> {
    const outcome = await this.auth.claimOwnRow(account, personId);
    if (outcome === 'claimed') return { personId, joined };
    // The account already holds a row here (0220): a second tap won. The caller looks again.
    // After `create`, the row just made stays on the list unheld, with the account's address
    // (named, accepted: two taps landing at once; the organiser can remove it).
    if (outcome === 'already_at_event') throw new ConflictException('Already on this Event');
    // `skipped` here needs another account to have taken a row carrying this account's address
    // between the read and the write (ruling 581): a server error, named, not fixed.
    throw new InternalServerErrorException(
      `Row ${personId} could not be claimed by its own address`,
    );
  }
}

/** Both typed names, or a 400 the page answers with two name boxes. */
function namesTyped(typed: Partial<Names>): Names {
  if (typed.givenName && typed.familyName) {
    return { givenName: typed.givenName, familyName: typed.familyName };
  }
  throw new BadRequestException({
    code: 'NAMES_REQUIRED',
    message: 'Your first and last name are needed to join.',
  });
}
