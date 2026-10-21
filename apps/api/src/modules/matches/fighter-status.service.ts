import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { COUNTED_FORFEIT_REASONS } from '@myclash/rulesets';
import type { ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import { blackCardEffectOf } from '../penalties/card-rules-pin';
import { cardAndForfeitRules, forfeitRulesRefusal } from '../penalties/forfeit-rules-in-force';
// Value imports ON PURPOSE: `import type` erases the DI metadata of a required parameter.
import { MatchCompletionService } from '../phases/match-completion.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { BoutDeps } from './fighter-bouts';
import { isOut, outOpponents, readFighter, type Fighter } from './fighter-cause';
import { bringBack, takeOut, type TakenOut } from './fighter-reconcile';
import { ClockService } from './clock.service';
import type { ForfeitVoidActor } from './forfeit-void';
import { FrozenResultsGuard } from './frozen-results.guard';
import { ScoringService } from './scoring.service';

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
 *
 * Then the Fighter's Pool bouts follow the status (`fighter-reconcile.ts`, 0241), on every settle,
 * never on a change only: a door cut short after the status moved would leave the bouts behind for
 * good. A bout put back faces two Fighters: the other one, out, forfeits it. Last, each Pool phase
 * whose bouts were completed is handed to the completion owner once, so the last Pool bout ended
 * by a forfeit fills the bracket (ruling 109).
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
  /**
   * Who the door acts for: the bouts the reconcile forfeits name them, and on an Event that is
   * over only a super admin's settle moves a bout.
   */
  actor?: ForfeitVoidActor;
  /** A Pool bout the door itself completed (a forfeit), for the completion owner (ruling 109). */
  completedPoolBout?: { matchId: string; phaseId: string };
  /** Bouts the door itself put back (a take-back): an opponent who is out forfeits them. */
  boutsPutBack?: string[];
}

/** What the bouts did after a settle, and one bout per Pool phase they were completed in. */
interface Followed {
  forfeited: number;
  broughtBack: number;
  boutPerPhase: Map<string, string>;
}

/** The status the Fighter had, and has. */
export interface Settled {
  before: string;
  after: string;
}

/** A settle's answer: the status, the bouts it forfeited, and the records it voided. */
export interface SettleResult extends Settled {
  forfeited: number;
  broughtBack: number;
}

/** The code of a hand change refused because the entry changed since the door read it. */
export const ENTRY_STATUS_CHANGED = 'entry_status_changed';

/** How many times the bouts follow a status that moves while they do, before a 5xx. */
const RECONCILE_ROUNDS = 3;

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
  private readonly logger = new Logger(FighterStatusService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly clock: ClockService,
    private readonly scoring: ScoringService,
    private readonly matchCompletion: MatchCompletionService,
    private readonly frozenResults: FrozenResultsGuard,
  ) {}

  async settle(input: SettleInput): Promise<SettleResult> {
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
    const followed = await this.reconcile(input, rules);
    await this.completePhases(input.completedPoolBout, followed.boutPerPhase);
    return {
      ...(data as Settled),
      forfeited: followed.forfeited,
      broughtBack: followed.broughtBack,
    };
  }

  /**
   * The bouts follow the status, until a reading of the status after them finds it where it was:
   * a settle of the same Fighter landing meanwhile moves it, and the last reconcile to finish
   * repairs what the interleaving left. A status that keeps moving is a 5xx, which the pad re-sends.
   * Then the bouts put back, by this reconcile or by the door, follow the other Fighter on them.
   */
  private async reconcile(input: SettleInput, rules: ForfeitRulesInForce) {
    const followed: Followed = { forfeited: 0, broughtBack: 0, boutPerPhase: new Map() };
    const actor = input.actor ?? {};
    if (!(await this.frozenResults.tournamentResultsOpen(input.tournamentId, actor.userId))) {
      this.logger.log(
        `Registration ${input.registrationId}: the Event is over, so its bouts stay as they are`,
      );
      return followed;
    }
    const putBack = [...(input.boutsPutBack ?? [])];
    await this.followStatus(input.registrationId, rules, actor, followed, putBack);
    // A bout faces two Fighters, and this settle followed one: the other, out, forfeits it.
    const db = this.supabase.service;
    // Through their own loop and its re-check: their settle may land meanwhile. What their loop
    // puts back is theirs to follow, not this settle's.
    for (const opponent of await outOpponents(db, input.registrationId, putBack)) {
      await this.followStatus(opponent.id, rules, actor, followed, []);
    }
    return followed;
  }

  private async followStatus(
    registrationId: string,
    rules: ForfeitRulesInForce,
    actor: ForfeitVoidActor,
    followed: Followed,
    putBack: string[],
  ): Promise<void> {
    const db = this.supabase.service;
    let fighter: Fighter = await readFighter(db, registrationId);
    for (let round = 0; round < RECONCILE_ROUNDS; round++) {
      const out = isOut(fighter.status);
      if (out) {
        this.tookOut(followed, await takeOut(this.boutDeps, fighter, rules, actor));
      } else {
        const back = await bringBack(this.boutDeps, fighter, actor);
        followed.broughtBack += back.voided;
        putBack.push(...back.putBack);
      }
      fighter = await readFighter(db, registrationId);
      if (isOut(fighter.status) === out) return;
    }
    throw new InternalServerErrorException(
      `The status of registration ${registrationId} kept moving while its bouts followed it`,
    );
  }

  private tookOut(followed: Followed, taken: TakenOut): void {
    followed.forfeited += taken.forfeited;
    for (const [phase, bout] of taken.boutPerPhase) {
      if (!followed.boutPerPhase.has(phase)) followed.boutPerPhase.set(phase, bout);
    }
  }

  /** Once per Pool phase: the door's own bout first, then each phase the reconcile completed in. */
  private async completePhases(
    door: SettleInput['completedPoolBout'],
    boutPerPhase: Map<string, string>,
  ): Promise<void> {
    const bouts = new Map<string, string>();
    if (door) bouts.set(door.phaseId, door.matchId);
    for (const [phase, bout] of boutPerPhase) if (!bouts.has(phase)) bouts.set(phase, bout);
    for (const matchId of bouts.values()) await this.matchCompletion.onMatchCompleted(matchId);
  }

  private get boutDeps(): BoutDeps {
    return {
      db: this.supabase.service,
      clock: this.clock,
      scoring: this.scoring,
      logger: this.logger,
    };
  }

  private async rulesInForce(tournamentId: string): Promise<ForfeitRulesInForce> {
    try {
      return (await cardAndForfeitRules(this.supabase.service, tournamentId)).forfeitRules;
    } catch (error) {
      throw forfeitRulesRefusal(error);
    }
  }
}
