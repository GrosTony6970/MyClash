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
import { entrantsToFollowOf, swissBackIn, swissOut } from './fighter-swiss';
import { ClockService } from './clock.service';
import { followRulesChangeOf, type RulesFollowed, type RulesMove } from './follow-rules-change';
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
 * Then the Fighter's Pool and Swiss bouts and Swiss pairings follow the status
 * (`fighter-reconcile.ts`, 0241; `fighter-swiss.ts`, 0244), on every settle, never on a change
 * only: a door cut short after the status moved would leave the bouts behind for good. A bout put
 * back faces two Fighters: the other one, out, forfeits it, and a Swiss bout put back reopens its
 * round. Last, each Pool phase and each Swiss round whose bouts were completed is handed to the
 * completion owner once, so the last bout ended by a forfeit fills the bracket or pairs the next
 * round (ruling 109).
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
  /**
   * A Pool or Swiss bout the door itself completed (a forfeit), for the completion owner (ruling
   * 109), and its unit: its Swiss round, else its Pool phase.
   */
  completedBout?: { matchId: string; unitId: string };
  /** Bouts the door itself put back (a take-back): an opponent who is out forfeits them. */
  boutsPutBack?: string[];
}

/**
 * What the bouts did after a settle: one bout per unit they were completed in, and every bout put
 * back, by the door or by the reconcile.
 */
interface Followed {
  forfeited: number;
  broughtBack: number;
  boutPerUnit: Map<string, string>;
  putBack: string[];
}

/** What a settle hands the completion owner: every bout put back, one bout per unit completed. */
interface HandOff {
  putBack: string[];
  boutPerUnit: Map<string, string>;
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

  /** `held`: a reopen's follow, which hands the rounds on once, after its last Fighter. */
  async settle(input: SettleInput, held?: HandOff): Promise<SettleResult> {
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
    const handOff = held ?? { putBack: [], boutPerUnit: new Map<string, string>() };
    handOff.putBack.push(...followed.putBack);
    for (const [unit, bout] of followed.boutPerUnit) {
      if (!handOff.boutPerUnit.has(unit)) handOff.boutPerUnit.set(unit, bout);
    }
    if (!held) await this.handOn(input.completedBout, handOff);
    return {
      ...(data as Settled),
      forfeited: followed.forfeited,
      broughtBack: followed.broughtBack,
    };
  }

  /**
   * A Swiss phase reopened (Resume, or a round count saved): each Fighter whose status it did not
   * follow while it was over is settled again, as if it had run all along. Out (ruling 127):
   * withdrawn from the next round, a paired bout not started forfeited. Back in (129): put back in
   * the pairings unless a round was paired without them, a forfeit 126 left voided. Still over by
   * its rounds, the phase is left alone (`swiss_phase_over`, 125). A "next round" committed while
   * this runs converges the way every status change does: the withdraw lands after it, and the
   * bout it paired is forfeited (123).
   *
   * The order of the rows changes nothing (129). The pairings of them all move first. Then the
   * Fighters are settled with every round hand-off held until the last one: a forfeit would close
   * a round and pair the next before a bout coming back was back in it. Those out come first, in
   * the order they went out (131): of two out on one bout, the first to leave forfeits it, as if
   * the phase had run — before a Fighter back in, whose settle would have their out opponent
   * forfeit every bout of theirs at once. Every Fighter is tried; a failure is a 5xx after the rest, and the doors
   * call this on every send (Resume, and Save, which sends the round count), so a resend repairs it.
   */
  async followReopenedSwissPhase(
    phaseId: string,
    tournamentId: string,
    actor: ForfeitVoidActor,
  ): Promise<void> {
    const db = this.supabase.service;
    const registrations = await entrantsToFollowOf(db, phaseId);
    if (registrations.length === 0) return;
    const rules = await this.rulesInForce(tournamentId);
    const failed: string[] = [];
    const fighters: Fighter[] = [];
    for (const id of registrations) {
      await this.tried(`Registration ${id}`, failed, async () =>
        fighters.push(await readFighter(db, id)),
      );
    }
    const ordered = [
      ...fighters
        .filter((fighter) => isOut(fighter.status))
        .sort((a, b) => Date.parse(a.outSince ?? '') - Date.parse(b.outSince ?? '')),
      ...fighters.filter((fighter) => !isOut(fighter.status)),
    ];
    for (const fighter of ordered) {
      await this.tried(`Registration ${fighter.id}`, failed, () =>
        isOut(fighter.status) ? swissOut(db, fighter) : swissBackIn(db, fighter),
      );
    }
    const held: HandOff = { putBack: [], boutPerUnit: new Map() };
    for (const { id } of ordered) {
      await this.tried(`Registration ${id}`, failed, () =>
        this.settle({ registrationId: id, tournamentId, rules, actor }, held),
      );
    }
    await this.tried('The round hand-off', failed, () => this.handOn(undefined, held));
    if (failed.length > 0) {
      throw new Error(`Swiss phase ${phaseId} reopened, but not followed: ${failed.join('; ')}`);
    }
  }

  /**
   * An audited change of the Tournament's forfeit rules is written: each Fighter it moves, and each
   * one out of step, is settled in the order the database gives (`follow-rules-change.ts`), every
   * settle reading the rules now in force, with ONE hand-off to the completion owner after the
   * last. Never throws: what did not follow is answered, for the dialog (ruling 144).
   */
  async followRulesChange(
    tournamentId: string,
    change: RulesMove,
    actor: ForfeitVoidActor,
  ): Promise<RulesFollowed & { handOffFailed: boolean }> {
    const held: HandOff = { putBack: [], boutPerUnit: new Map() };
    const logged = (step: string, error: unknown) =>
      this.logger.error(`${step} did not follow a rules change`, (error as Error).stack);
    const followed = await followRulesChangeOf(
      {
        db: this.supabase.service,
        settle: (registrationId) => this.settle({ registrationId, tournamentId, actor }, held),
        logged,
      },
      tournamentId,
      change,
    );
    try {
      await this.handOn(undefined, held);
      return { ...followed, handOffFailed: false };
    } catch (error) {
      logged('The hand-off of a rules change', error);
      return { ...followed, handOffFailed: true };
    }
  }

  /** One step of a reopen's follow: a failure is logged and kept, the rest go on. */
  private async tried(who: string, failed: string[], step: () => Promise<unknown>) {
    try {
      await step();
    } catch (error) {
      this.logger.error(`${who} did not follow a reopened Swiss phase`, (error as Error).stack);
      failed.push(`${who}: ${(error as Error).message}`);
    }
  }

  /**
   * A Swiss bout put back reopens its round, read from the bouts as they now are; then each unit
   * the bouts were completed in is handed to the completion owner.
   */
  private async handOn(door: SettleInput['completedBout'], handOff: HandOff): Promise<void> {
    for (const matchId of new Set(handOff.putBack)) {
      await this.matchCompletion.onBoutPutBack(matchId);
    }
    await this.completeUnits(door, handOff.boutPerUnit);
  }

  /**
   * The bouts follow the status, until a reading of the status after them finds it where it was:
   * a settle of the same Fighter landing meanwhile moves it, and the last reconcile to finish
   * repairs what the interleaving left. A status that keeps moving is a 5xx, which the pad re-sends.
   * Then the bouts put back, by this reconcile or by the door, follow the other Fighter on them.
   */
  private async reconcile(input: SettleInput, rules: ForfeitRulesInForce) {
    const followed: Followed = {
      forfeited: 0,
      broughtBack: 0,
      boutPerUnit: new Map(),
      putBack: [],
    };
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
    // puts back is theirs to follow, not this settle's; its rounds are reopened all the same.
    const theirs: string[] = [];
    for (const opponent of await outOpponents(db, input.registrationId, putBack)) {
      await this.followStatus(opponent.id, rules, actor, followed, theirs);
    }
    followed.putBack.push(...putBack, ...theirs);
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
        // Out of the pairings FIRST: a round paired before is seen by the bouts read, and the
        // round the forfeits close pairs without them.
        await swissOut(db, fighter);
        this.tookOut(followed, await takeOut(this.boutDeps, fighter, rules, actor));
      } else {
        const back = await bringBack(this.boutDeps, fighter, actor);
        followed.broughtBack += back.voided;
        putBack.push(...back.putBack);
        await swissBackIn(db, fighter);
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
    for (const [unit, bout] of taken.boutPerUnit) {
      if (!followed.boutPerUnit.has(unit)) followed.boutPerUnit.set(unit, bout);
    }
  }

  /**
   * Once per Pool phase and per Swiss round: the door's own bout first, then each unit the
   * reconcile completed bouts in.
   */
  private async completeUnits(
    door: SettleInput['completedBout'],
    boutPerUnit: Map<string, string>,
  ): Promise<void> {
    const bouts = new Map<string, string>();
    if (door) bouts.set(door.unitId, door.matchId);
    for (const [unit, bout] of boutPerUnit) if (!bouts.has(unit)) bouts.set(unit, bout);
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
