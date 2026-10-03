/**
 * card-switches.ts — the three alert switches of a card of the Following tab (operator rulings
 * 239, 239a, 239b).
 *
 * A follow is saved per Event, and each carries its own three switches: bout, referee duty,
 * Workshop. A person followed in two coming Events has two follows, and the card has ONE set of
 * switches. So the set speaks for every coming Event follow of that person at once: a switch
 * shows on only when it is on in every one of them, a tap saves all of them in one statement,
 * and a follow made later takes the set as it stands. No screen sets one Event apart.
 *
 * Which follows a card speaks for is `FollowsService.comingEventFollows`, read by the list and
 * by the save alike. A leaf of `FollowsService`, which is long.
 */
import type { SupabaseService } from '../supabase/supabase.service';

export interface CardSwitches {
  notifyMatchStart: boolean;
  notifyWorkshopStart: boolean;
  notifyRefereeStart: boolean;
}

/** The switches a tap changes: the others stay as saved, Event by Event. */
export type CardSwitchPatch = Partial<CardSwitches>;

type Row = Record<string, unknown>;

const COLUMN = {
  notifyMatchStart: 'notify_match_start',
  notifyWorkshopStart: 'notify_workshop_start',
  notifyRefereeStart: 'notify_referee_start',
} as const satisfies Record<keyof CardSwitches, string>;

/** The first follow of a person: told of the bouts, not of the duties or the Workshops. */
export const FIRST_FOLLOW_SWITCHES: CardSwitches = {
  notifyMatchStart: true,
  notifyWorkshopStart: false,
  notifyRefereeStart: false,
};

/** A set of switches as the columns of a follow row. */
export function switchColumns(switches: CardSwitchPatch): Row {
  const columns: Row = {};
  for (const key of Object.keys(COLUMN) as Array<keyof CardSwitches>) {
    if (switches[key] !== undefined) columns[COLUMN[key]] = switches[key];
  }
  return columns;
}

/** The set a card shows for these follows: on only when on in EVERY one. `rows`: at least one. */
export function cardSwitches(rows: readonly Row[]): CardSwitches {
  const on = (key: keyof CardSwitches) => rows.every((row) => row[COLUMN[key]] === true);
  return {
    notifyMatchStart: on('notifyMatchStart'),
    notifyWorkshopStart: on('notifyWorkshopStart'),
    notifyRefereeStart: on('notifyRefereeStart'),
  };
}

/**
 * ONE statement on the account's own follows among `followIds`; the rows as saved. PostgREST
 * hands back no row unless asked, and "no row" is how a follow that is gone is told. A failed
 * write is a plain Error, a 5xx: never "no follow".
 */
export async function writeCardSwitches(
  supabase: SupabaseService,
  userId: string,
  followIds: readonly string[],
  patch: CardSwitchPatch,
): Promise<Row[]> {
  const { data, error } = await supabase.service
    .from('follows')
    .update(switchColumns(patch))
    .eq('follower_user_id', userId)
    .in('id', followIds)
    .select('followed_person_id, notify_match_start, notify_workshop_start, notify_referee_start');
  if (error) throw new Error(`follow switches write failed: ${error.message}`);
  return (data ?? []) as Row[];
}
