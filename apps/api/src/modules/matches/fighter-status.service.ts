import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { COUNTED_FORFEIT_REASONS } from '@myclash/rulesets';
import type { ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import { blackCardEffectOf } from '../penalties/card-rules-pin';
import { cardAndForfeitRules, forfeitRulesRefusal } from '../penalties/forfeit-rules-in-force';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * A Fighter's status in a Tournament, worked out from what is live now (slice B, migration 0240):
 * their live forfeits, their live black cards under the rules in force, a confirmed review, and
 * the organiser's hand. The database works it out in one locked step, `settle_fighter_status`,
 * and nothing else in the API writes it. (The web door `registrations_write` still can, until
 * ruling 98's sweep closes it.)
 *
 * Every door that adds, voids or answers a cause calls `settle` AFTER its own write, and so does
 * every retry of one: the settle reads committed causes under the Registration's row lock, so the
 * last one to run reads them all, and a retry repairs a first send cut short after its cause.
 */

/** The organiser's hand (`registrations.entry_status`). */
export type EntryStatus = 'registered' | 'checked_in' | 'withdrawn' | 'waitlist';

export interface SettleInput {
  registrationId: string;
  tournamentId: string;
  /** The rules in force, when the door read them already (a black card does). */
  rules?: ForfeitRulesInForce;
  /**
   * A hand door's change: the new hand, the hand it read (another one refuses with
   * `entry_status_changed`), and for a promote, its seat on the waitlist cleared.
   */
  entry?: { status: EntryStatus; expected?: EntryStatus; clearWaitlist?: boolean };
}

/** The status the Fighter had, and has. */
export interface Settled {
  before: string;
  after: string;
}

/** The code of a hand change refused because the entry changed since the door read it. */
export const ENTRY_STATUS_CHANGED = 'entry_status_changed';

/** The refusal of a hand change whose entry changed since its door read it. */
export function isEntryStatusChanged(error: unknown): boolean {
  if (!(error instanceof ConflictException)) return false;
  const body = error.getResponse();
  return typeof body === 'object' && (body as { code?: unknown }).code === ENTRY_STATUS_CHANGED;
}

/** What the database reads of the rules in force (0240's `p_rules`). */
export function settleRules(rules: ForfeitRulesInForce) {
  return {
    disqualifyAfter: rules.disqualifyAfter === 'off' ? null : rules.disqualifyAfter,
    firstCardOut: blackCardEffectOf(rules, 'black_card_1') === 'tournament',
    secondCardOut: blackCardEffectOf(rules, 'black_card_2') === 'tournament',
    countedReasons: [...COUNTED_FORFEIT_REASONS],
  };
}

function refusalOf(error: { code?: string; message: string }, registrationId: string): Error {
  if (error.code === 'P0001' && error.message.includes(ENTRY_STATUS_CHANGED)) {
    return new ConflictException({
      message: 'This entry changed since it was read: read it again',
      code: ENTRY_STATUS_CHANGED,
    });
  }
  if (error.code === 'P0002')
    return new NotFoundException(`Registration ${registrationId} not found`);
  // A server error, never a 400: the cause is written, and the pad re-sends on a 5xx only.
  return new Error(
    `The status of registration ${registrationId} was not settled: ${error.message}`,
  );
}

@Injectable()
export class FighterStatusService {
  constructor(private readonly supabase: SupabaseService) {}

  async settle(input: SettleInput): Promise<Settled> {
    const rules = input.rules ?? (await this.rulesInForce(input.tournamentId));
    const { data, error } = await this.supabase.service.rpc('settle_fighter_status', {
      p_registration: input.registrationId,
      p_rules: settleRules(rules),
      // The server's clock, never a tablet's time: it starts the Fighter's spell out.
      p_now: new Date().toISOString(),
      p_entry_status: input.entry?.status ?? null,
      p_expected_entry_status: input.entry?.expected ?? null,
      p_clear_waitlist: input.entry?.clearWaitlist ?? false,
    });
    if (error) throw refusalOf(error, input.registrationId);
    return data as Settled;
  }

  private async rulesInForce(tournamentId: string): Promise<ForfeitRulesInForce> {
    try {
      return (await cardAndForfeitRules(this.supabase.service, tournamentId)).forfeitRules;
    } catch (error) {
      throw forfeitRulesRefusal(error);
    }
  }
}
