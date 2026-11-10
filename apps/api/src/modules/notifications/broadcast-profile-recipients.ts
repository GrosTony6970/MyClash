/**
 * broadcast-profile-recipients.ts — who a broadcast reaches when its audience is named by profile
 * (`global_persons.id`): the referees (operator ruling 216) and the instructors (rulings 533, 534).
 *
 * A referee's duties name his PROFILE (since 0063), and so do an instructor's places (a Workshop's
 * `workshop_instructors`, the Event's `event_instructors`). A recipient row can name only a roster
 * row (`event_broadcast_recipients.person_id` references `persons(id)`), and a person taken from
 * the directory may have no roster row in the Event.
 *
 * - A roster row in the Event: that row, its holder and its address, as for a Fighter.
 * - None, and an account holds the profile: that account, at its own address (`accountEmails`,
 *   one call for all of them). The recipient names no roster row. It used to name the profile's
 *   id there: the database refused it, and the whole broadcast with it, so one such referee made
 *   a broadcast to "referees" answer 400 for everybody.
 * - None, and no account holds the profile: left out, and logged. Nobody can be told. The
 *   profile's own `email` is not an address to mail: it can be stale or organiser-typed (201a).
 */
import type { Logger } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import { accountEmails } from './account-emails';

export interface BroadcastRecipient {
  /** The roster row of the Event; null for a person who has none there. */
  personId: string | null;
  userId: string | null;
  email: string | null;
}

export interface ProfileRecipientsDeps {
  supabase: SupabaseService;
  logger: Pick<Logger, 'warn'>;
}

/** The audience a list of profiles was read for: it names them in the logs and the errors. */
export type ProfileRole = 'referee' | 'instructor';

const ROLE_WORDS: Record<ProfileRole, { one: string; title: string }> = {
  referee: { one: 'referee', title: 'Referee' },
  instructor: { one: 'instructor', title: 'Instructor' },
};

/** The recipients behind a list of profiles (`global_persons.id`), for one Event. */
export async function profileRecipients(
  deps: ProfileRecipientsDeps,
  eventId: string,
  profileIds: string[],
  role: ProfileRole,
): Promise<BroadcastRecipient[]> {
  const { data, error } = await deps.supabase.service
    .from('persons')
    .select('id, global_person_id, claimed_by_user_id, email')
    .eq('event_id', eventId)
    .in('global_person_id', profileIds);
  if (error) throw new Error(`${ROLE_WORDS[role].title} roster rows unreadable: ${error.message}`);

  const onRoster = new Map<string, BroadcastRecipient>();
  for (const row of (data ?? []) as Array<{
    id: string;
    global_person_id: string;
    claimed_by_user_id: string | null;
    email: string | null;
  }>) {
    onRoster.set(row.global_person_id, {
      personId: row.id,
      userId: row.claimed_by_user_id,
      email: row.email,
    });
  }

  const offRoster = profileIds.filter((id) => !onRoster.has(id));
  return [...onRoster.values(), ...(await accountRecipients(deps, eventId, offRoster, role))];
}

/** Profiles with no roster row in the Event: the account that holds each one. */
async function accountRecipients(
  deps: ProfileRecipientsDeps,
  eventId: string,
  profileIds: string[],
  role: ProfileRole,
): Promise<BroadcastRecipient[]> {
  if (profileIds.length === 0) return [];

  const { data, error } = await deps.supabase.service
    .from('global_persons')
    .select('id, claimed_by_user_id')
    .in('id', profileIds);
  if (error) throw new Error(`${ROLE_WORDS[role].title} profiles unreadable: ${error.message}`);

  const holders = new Map(
    ((data ?? []) as Array<{ id: string; claimed_by_user_id: string | null }>).map((row) => [
      row.id,
      row.claimed_by_user_id,
    ]),
  );
  const unheld = profileIds.filter((id) => !holders.get(id));
  if (unheld.length > 0) {
    deps.logger.warn(
      `Broadcast of ${eventId}: ${unheld.length} ${ROLE_WORDS[role].one}(s) left out, no roster row here and no account: ${unheld.join(', ')}`,
    );
  }

  const userIds = profileIds
    .map((id) => holders.get(id))
    .filter((userId): userId is string => Boolean(userId));
  const emails = await accountEmails(deps, userIds, `Broadcast of ${eventId}`);
  return userIds.map((userId) => ({
    personId: null,
    userId,
    email: emails.get(userId) ?? null,
  }));
}
