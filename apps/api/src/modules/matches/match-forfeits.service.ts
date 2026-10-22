import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  COUNTED_FORFEIT_REASONS,
  forfeitOutcomeOf,
  isBlackCardReason,
  isOverrideReason,
  OVERRIDE_OUTCOME,
  type BlackCardEffect,
  type ForfeitOutcome,
  type ForfeitReason,
} from '@myclash/rulesets';
import { asksInPhase, isPoolOrSwissPhase, type ForfeitRules } from '@myclash/types/forfeit-rules';
import { blackCardEffectOf } from '../penalties/card-rules-pin';
import { cardAndForfeitRules, forfeitRulesRefusal } from '../penalties/forfeit-rules-in-force';
import { SupabaseService } from '../supabase/supabase.service';
// Value import ON PURPOSE — `import type` erases DI metadata and @Optional()
// silently injects undefined (see di-wiring.regression.test.ts).
import { MatchCompletionService } from '../phases/match-completion.service';
import { BracketAdvanceService } from '../phases/bracket-advance.service';
import { restampAfterInsert } from '../phases/match-ruleset';
import type { CreateMatchForfeitDto } from './dto/matches.dto';
import { ClockService } from './clock.service';
import {
  completeMatch,
  insertForfeit,
  matchSnapshot,
  readSheetAgain,
  recordedResultDiverged,
  reopenClockTakenBack,
  resolveScores,
  restoreMatchState,
  rulesetsOfBoutsPutBack,
  stampResultingState,
  winnerOf,
  type BoutDeps,
} from './fighter-bouts';
import { isOut } from './fighter-cause';
import { FighterStatusService, type SettleInput } from './fighter-status.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import { forfeitEndReason } from './forfeit-end-reason';
import { hasBeenFought } from './fought-match';
import { matchLocked } from './match-locked';
import { stampForfeitVoided } from './forfeit-void';
import { ScoringService } from './scoring.service';

/**
 * `canOverrideLocked` comes from `authorizeMatchScoring` and was being dropped
 * on the floor: the controller has always passed the full ScoringActor, and
 * this type simply did not declare the flag, so the lock could not be honoured
 * even in principle.
 */
type Actor = { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean };
type Row = Record<string, unknown>;

/** What a forfeit did to its Fighter at its time (`match_forfeits.fighter_outcome`, 0240). */
type FighterOutcome = 'withdrawn' | 'disqualified' | null;

/**
 * What a new record belongs under: a live root forfeit or, with none, whatever else holds the
 * Fighter out with no live root — the hand, a black card, a confirmed review (rulings 118, 120).
 */
interface Inheritance {
  parentId: string | null;
  underOutStatus: boolean;
}

/**
 * `settledByCaller`: the take-back of a black card's forfeit, whose door settles the Fighter once
 * the card itself is voided. A settle here would read the card still live and forfeit the bout
 * just put back, for the door's own settle to bring it back again.
 */
export interface VoidOptions {
  settledByCaller?: boolean;
}

/**
 * A forfeit's own effect on its Fighter, stored once at its insert and read by the status settle.
 * None for an override (nobody forfeited), nor for a black card's forfeit its card sent (the card
 * is the cause, ruling 56, and the settle counts the cards). A black card forfeit recorded by hand
 * has no card: it stores what its card rule does (rulings 58, 82). A forfeit recorded under what
 * holds the Fighter out is one of its effects, so it withdraws nobody (rulings 89, 118, 120: the
 * Fighter's return frees them, 105), but one whose reason disqualifies still does (112).
 * "Disqualify after N" is never stored: the settle counts (ruling 80).
 */
function fighterOutcomeOf(
  reason: string,
  stored: string,
  canContinue: boolean | null,
  opts: { inherited: boolean; sentByItsCard: boolean },
): FighterOutcome {
  if (isOverrideReason(reason) || (isBlackCardReason(reason) && opts.sentByItsCard)) return null;
  if (stored === 'disqualified') return 'disqualified';
  return !opts.inherited && canContinue === false ? 'withdrawn' : null;
}

/**
 * The rules a forfeit is recorded by: the Tournament's forfeit rules of now and, for a black card,
 * what that card does. The card path reads both before it writes the card and hands them over.
 */
export interface ForfeitInForce {
  rules: ForfeitRules;
  cardEffect: BlackCardEffect | null;
}

/**
 * Where one live record sits in the cascade, computed on the READ.
 *
 * None of it is derivable from the record itself: `parent_forfeit_id` says a
 * parent exists, not whether that parent is still on record, and nothing on the
 * row counts the children a void would carry down. The organiser needs both to
 * be told the truth about what voiding this record does.
 */
export interface ForfeitCascadeContext {
  /**
   * `child` — this record was written under a withdrawal (auto-created by the
   * cascade, or re-recorded on a bout the organiser reopened).
   * `root` — this record withdrew the fighter and carries live children.
   * `standalone` — it closed nothing but its own bout.
   */
  role: 'root' | 'child' | 'standalone';
  /** Live children this void would carry down. */
  childCount: number;
  /** For a child: is the record that withdrew the fighter still on record? */
  parentActive: boolean;
}

@Injectable()
export class MatchForfeitsService {
  private readonly logger = new Logger(MatchForfeitsService.name);
  private readonly fighterStatus: FighterStatusService;

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly matchCompletion?: MatchCompletionService,
    // Optional so direct `new MatchForfeitsService(supabase)` in tests still
    // works; in the app it's provided by MatchesModule (Supabase-only dep).
    @Optional() private readonly clock?: ClockService,
    @Optional() private readonly bracketAdvance?: BracketAdvanceService,
    @Optional() private readonly frozenResults?: FrozenResultsGuard,
    @Optional() private readonly scoring?: ScoringService,
    // REQUIRED, and last only because a required parameter cannot follow optional ones. The
    // `?:` shape keeps the class in `design:paramtypes` (a `T | undefined` type emits `Object`,
    // and Nest would then inject undefined into every `@Optional()` one above); Nest injects it
    // as it does every required dependency, and a hand construction without it throws here.
    fighterStatus?: FighterStatusService,
  ) {
    if (!fighterStatus) throw new Error('MatchForfeitsService needs the FighterStatusService');
    this.fighterStatus = fighterStatus;
  }

  /**
   * `causedAt`: of a black card a tablet kept in its queue, the server's time
   * of that card (`scoredAtServer`). The clock is ended there, not at the time
   * the queue arrives. A forfeit a person records has none: now.
   *
   * `inForce`: the rules the card path read before it wrote its card. A forfeit
   * recorded by hand reads them itself; an override reads none, as it states
   * the result.
   */
  async createForfeit(
    matchId: string,
    dto: CreateMatchForfeitDto,
    actor: Actor = {},
    causedAt?: string,
    inForce?: ForfeitInForce,
  ) {
    const match = await this.loadMatch(matchId);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);

    const wasCompleted = match.status === 'completed';
    await this.assertWritable(matchId, match, dto, actor);

    const phase = this.phase(match);
    const active = await this.existingRecord(matchId, dto);
    if (active) {
      // A retry: its first send may have stopped after the record, before the settle.
      await this.settleIfTheirs(active, dto.forfeitingRegistrationId, actor, phase);
      return active;
    }

    const rules = isOverrideReason(dto.reason)
      ? null
      : (inForce ?? (await this.handForfeitRules(phase.tournament_id, dto.reason)));
    const policy: ForfeitOutcome = rules
      ? forfeitOutcomeOf(rules.rules, dto.reason as ForfeitReason, phase.type)
      : OVERRIDE_OUTCOME;
    const winnerRegistrationId = winnerOf(match, dto.forfeitingRegistrationId, policy);

    // The forfeit rules can escalate the per-reason state to a disqualification.
    // Resolved BEFORE canContinue, because a DQ implies the fighter cannot
    // continue (which in pools also auto-forfeits their remaining matches).
    // A forfeit recorded under what holds the Fighter out belongs to it, and is no
    // new forfeit of the Fighter: it escalates nothing (rulings 89, 118, 120). Nor
    // does an override: nobody forfeited.
    const inheritance = await this.resolveInheritance(matchId, dto, phase);
    const inherited = inheritance.parentId !== null || inheritance.underOutStatus;
    const reasonState = this.reasonState(
      dto.reason,
      policy.tournamentState,
      rules?.cardEffect ?? null,
    );
    const escalated =
      inherited || !rules
        ? { state: reasonState, stored: reasonState }
        : await this.escalateTournamentState(
            dto.forfeitingRegistrationId,
            matchId,
            phase.tournament_id,
            reasonState,
            rules.rules,
            dto.reason as ForfeitReason,
          );
    // Stored as `can_continue`: a later forfeit of this Fighter hangs off a record that took them
    // out, "after N" included (`resolveInheritance`). Their bouts follow their status.
    const canContinue = this.resolveCanContinue(escalated.state, dto.canContinue, phase.type);
    const fighterOutcome = fighterOutcomeOf(
      dto.reason,
      escalated.stored,
      this.resolveCanContinue(escalated.stored, dto.canContinue, phase.type),
      // `inForce` is handed over by the card path alone, which writes its card first.
      { inherited, sentByItsCard: inForce !== undefined },
    );
    const scores = resolveScores(match, dto.forfeitingRegistrationId, policy, dto.explicitScores);
    const now = new Date().toISOString();

    const forfeit = await this.insertForfeit({
      match_id: matchId,
      parent_forfeit_id: inheritance.parentId,
      under_out_status: inheritance.underOutStatus,
      tournament_id: phase.tournament_id,
      forfeiting_registration_id: dto.forfeitingRegistrationId,
      winner_registration_id: winnerRegistrationId,
      reason: dto.reason,
      score_policy: policy.scorePolicy,
      forfeiting_score: scores.forfeitingScore,
      opponent_score: scores.opponentScore,
      can_continue: canContinue,
      fighter_outcome: fighterOutcome,
      auto_created: false,
      previous_match_state: matchSnapshot(match),
      note: dto.note ?? null,
      by_user_id: actor.userId ?? null,
      staff_account_id: actor.staffAccountId ?? null,
    });

    // RESOLVED BEFORE THE BOUT IS COMPLETED, not after. Replacing a no-show with
    // a reserve means the bout has not happened — so the honest sequence is to
    // never complete it, rather than to complete it and write it back.
    //
    // It used to run after `completeMatch`, reading `status` off the snapshot
    // loaded at the top of this method. That made the guard `!== 'scheduled'`
    // read a value the row no longer held, and its remedy was to write the row
    // back to scheduled/0-0 — an un-completion that bypassed
    // `MatchCompletionService` entirely. Self-inverting within the request, so
    // never data loss, but it broke the invariant the un-completion owner now
    // assumes, and left a bout momentarily completed that never was.
    const replacementRegistrationId =
      phase.type === 'pool'
        ? null
        : await this.tryReplaceMainRoundOneFighter(
            match,
            dto.forfeitingRegistrationId,
            dto.reason as ForfeitReason,
          );

    if (!replacementRegistrationId) {
      await completeMatch(this.boutDeps, matchId, {
        winnerRegistrationId,
        scores,
        endReason: forfeitEndReason(dto.reason),
        endedAt: now,
        causedAt,
      });
    }

    // A pool match feeds no bracket slot, so a pool forfeit has no dependents
    // and this list stays empty. It used to hold the auto-forfeited CHILD match
    // ids — whose one reader is `assertNoneStarted`, whose started-set includes
    // 'completed', and the cascade had just completed every one of them. Every
    // cascading pool forfeit was therefore permanently unvoidable. The bouts a
    // withdrawal forfeits are EFFECTS of the Fighter's status, not dependents of
    // this record: they follow the status the settle below works out.
    const downstreamIds: string[] = [];
    if (phase.type !== 'pool') {
      downstreamIds.push(
        ...(await this.applyBracketOutcome(match, phase, forfeit.id as string, {
          wasCompleted,
          replacementRegistrationId,
          now,
        })),
      );
    }

    if (downstreamIds.length > 0) {
      await this.supabase.service
        .from('match_forfeits')
        .update({ downstream_match_ids: downstreamIds, updated_at: now })
        .eq('id', forfeit.id as string);
    }

    // Last, once every branch above has had its say about the matches row.
    await stampResultingState(this.supabase.service, forfeit.id as string, matchId);

    // After every write of the door: a settle that fails leaves the forfeit whole, and the
    // retry ("Match is already closed") settles. Its Pool bouts follow the status, and the
    // last Pool bout a forfeit ends fills the bracket (ruling 109).
    await this.settleFighterOf(forfeit, actor, phase);
    return { ...forfeit, downstream_match_ids: downstreamIds };
  }

  /**
   * The live record on this match, if one already exists — or a conflict.
   *
   * A repeated FORFEIT stays idempotent: the pad can double-tap, and the second
   * press must not create a second row or error at the referee mid-bout.
   *
   * A repeated OVERRIDE must not be idempotent. Before overrides existed,
   * `assertWritable` refused a second attempt outright, so returning the
   * existing row was unreachable for anything a user could retry; admitting
   * completed matches turned it into a live trap that answered 201 and wrote
   * nothing — so correcting a mistyped score, or correcting a match that ended
   * in a real forfeit (the case migration 0177 exists for), silently did
   * nothing while the UI reported success.
   *
   * `match_forfeits_one_active_per_match` means a second row cannot be inserted
   * anyway, so the honest answer is a conflict that names the remedy — and
   * `GET /matches/:id/forfeit` plus the admin void button are what make that
   * remedy reachable.
   */
  private async existingRecord(matchId: string, dto: CreateMatchForfeitDto): Promise<Row | null> {
    const active = await this.loadActiveForfeit(matchId);
    if (active && isOverrideReason(dto.reason)) {
      throw new ConflictException(
        'This match already has a forfeit or override on record. Void it before recording another.',
      );
    }
    return active;
  }

  /**
   * The live forfeit/override on this match, or null.
   *
   * Exists so the organiser can SEE the record that a second attempt now
   * conflicts with, and void it. Without this read the 409 names a remedy
   * nothing in the product can reach — `PATCH /match-forfeits/:id/void` had no
   * caller in any app.
   */
  async getActiveForfeit(matchId: string): Promise<Row | null> {
    const active = await this.loadActiveForfeit(matchId);
    if (!active) return null;
    return { ...active, cascade: await this.cascadeContext(active) };
  }

  /**
   * Where this record sits in the cascade — see `ForfeitCascadeContext`.
   *
   * Two cheap indexed reads, on the ORGANISER READ only: the write path calls
   * `loadActiveForfeit` directly, so the pad's idempotency check and the
   * override conflict both cost exactly what they did before.
   */
  private async cascadeContext(forfeit: Row): Promise<ForfeitCascadeContext> {
    const parentId = (forfeit['parent_forfeit_id'] as string | null) ?? null;

    // Served by 0178's `match_forfeits_parent_forfeit_id_idx`.
    const { count } = await this.supabase.service
      .from('match_forfeits')
      .select('id', { count: 'exact', head: true })
      .eq('parent_forfeit_id', forfeit['id'] as string)
      .is('voided_at', null);
    const childCount = count ?? 0;

    let parentActive = false;
    if (parentId) {
      const { data } = await this.supabase.service
        .from('match_forfeits')
        .select('voided_at')
        .eq('id', parentId)
        .maybeSingle();
      const parent = data as Row | null;
      parentActive = !!parent && parent['voided_at'] == null;
    }

    return {
      role: parentId ? 'child' : childCount > 0 ? 'root' : 'standalone',
      childCount,
      parentActive,
    };
  }

  /**
   * What this new record belongs under: a live ROOT forfeit, or what else holds the Fighter out.
   *
   * The case: an injury withdraws a fighter mid-pool and their remaining bouts
   * are forfeited because they are out. The organiser voids ONE of those to put
   * that bout back on, and a fresh forfeit is written on it later (ruling 89).
   * Without this the new row is a root of its own, so voiding the injury no
   * longer brings it back (ruling 105) and the fighter returns carrying an F
   * that names a withdrawal nothing points at. The organiser's hand, a black
   * card, a confirmed review — whatever holds the Fighter out with no live root —
   * leave nothing to hang off: the new row is marked as under the Fighter's out status
   * (rulings 118, 120), and the Fighter's return brings it back.
   *
   * Keyed on THIS BOUT: it held a bout forfeited because the Fighter was out,
   * live or voided. Not on the Pool: a forfeit the Fighter really chose later in
   * the Pool, on a bout the withdrawal never closed (one running then), is a
   * forfeit of its own and counts.
   *
   * Read PRESENT STATE for the root, never the void history. A root that was
   * voided and re-recorded is a DIFFERENT row, and it is the new one that has
   * the fighter withdrawn. Never a bout forfeited because the Fighter was out
   * (`auto_created`), nor a record under the out status: those are effects, not roots.
   */
  private async resolveInheritance(
    matchId: string,
    dto: CreateMatchForfeitDto,
    phase: { tournament_id: string },
  ): Promise<Inheritance> {
    const none: Inheritance = { parentId: null, underOutStatus: false };
    // NEVER for an override. An override asserts the bout WAS fought and the
    // result was X; hanging it off a withdrawal would let voiding that
    // withdrawal erase a result an organiser stated. Nor for a black card: the
    // card is a cause of its own, which voiding the withdrawal must not erase.
    if (isOverrideReason(dto.reason) || isBlackCardReason(dto.reason)) return none;
    const db = this.supabase.service;
    const readFailed = (what: string, error: { message: string }) =>
      new Error(`${what} of match ${matchId} could not be read: ${error.message}`);
    const forfeitedHere = await db
      .from('match_forfeits')
      .select('id')
      .eq('match_id', matchId)
      .eq('forfeiting_registration_id', dto.forfeitingRegistrationId)
      .eq('auto_created', true)
      .limit(1);
    if (forfeitedHere.error) throw readFailed('The forfeits', forfeitedHere.error);
    if ((forfeitedHere.data ?? []).length === 0) return none;

    const roots = await db
      .from('match_forfeits')
      .select('id')
      .eq('tournament_id', phase.tournament_id)
      .eq('forfeiting_registration_id', dto.forfeitingRegistrationId)
      // Roots a person wrote, and only a record that actually withdrew the
      // fighter — a one-bout forfeit closed nothing else and adopts nothing.
      .is('parent_forfeit_id', null)
      .eq('auto_created', false)
      .eq('under_out_status', false)
      .eq('can_continue', false)
      .is('voided_at', null)
      .neq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (roots.error) throw readFailed('The withdrawals', roots.error);
    const root = (roots.data ?? [])[0] as Row | undefined;
    if (root) return { parentId: root['id'] as string, underOutStatus: false };
    return { parentId: null, underOutStatus: await this.heldOut(dto.forfeitingRegistrationId) };
  }

  /**
   * Something holds the Fighter out of the Tournament: the status the last settle worked out
   * (0240). With no live root, that is the hand, a black card, a confirmed review, or another
   * cause no root stands for.
   *
   * THE RACES: read outside the settle's row lock. (1) Two doors at once: this one reads "out",
   * the door that brings the Fighter back settles "in" before this record is written; this door's
   * own settle then works out "in", and its reconcile voids the record just written and puts its
   * bout back (0241's hand read had the same window). (2) A door that changed a cause and whose
   * settle failed (a 5xx; its retry settles) leaves the status behind its causes, and a forfeit
   * recorded before that retry is marked by the old status: the hand's own column never lagged
   * (the settle writes it), a card or a review can. Both accepted: rare, and the organiser sees
   * the bout's result.
   */
  private async heldOut(registrationId: string): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('status')
      .eq('id', registrationId)
      .maybeSingle();
    if (error)
      throw new Error(`Registration ${registrationId} could not be read: ${error.message}`);
    return isOut(((data as Row | null)?.['status'] as string | undefined) ?? '');
  }

  /**
   * Undo a forfeit or override: restore the result it replaced.
   *
   * Everything the WRITE half refuses, this half must refuse too. It did not,
   * and that only became reachable when this endpoint gained its first caller:
   * a completed event's freeze and a locked match both stopped the recording
   * and neither stopped the undoing, so the same organiser who could not write
   * an override could erase a published one.
   *
   * And it must undo the same things the write DID. Advancement is the one
   * that bites: a bracket forfeit sends the winner into the next round, and
   * restoring the match here left them there — then the replayed bout could
   * never re-advance, because `advanceFromSlot` fills a downstream side only
   * while it is null. The bracket would silently keep the loser of the replay.
   *
   * NOT ROUTED THROUGH `MatchCompletionService.onMatchUncompleted`, deliberately
   * rather than by omission, so the question does not get re-opened. This path
   * restores a PREVIOUS state, which for an override is itself `completed` with
   * a winner — so it re-advances (`readvanceIfDecided`) exactly where the owner
   * would revert. The owner would also refuse through the whole dependent
   * closure, where this has its own narrower and already-tested guard in
   * `assertNoneStarted` over `downstream_match_ids`. Consolidating would change
   * behaviour and buy nothing; only `stampVoided` is shared, via
   * `forfeit-void.ts`.
   */
  async voidForfeit(forfeitId: string, actor: Actor = {}, opts: VoidOptions = {}) {
    const forfeit = await this.standingForfeit(forfeitId, actor, opts);
    const matchId = forfeit['match_id'] as string;
    await this.assertVoidable(matchId, actor);
    await this.assertMatchStillHoldsRecordedResult(matchId, forfeit);

    const downstreamIds = Array.isArray(forfeit['downstream_match_ids'])
      ? (forfeit['downstream_match_ids'] as string[])
      : [];
    await this.assertNoneStarted(
      downstreamIds,
      'Cannot void forfeit after a dependent match has started',
    );

    const previousMatch = (forfeit['previous_match_state'] as Row | null) ?? {};
    // Every read that can fail comes BEFORE the first write: a take-back cut
    // short after its own bout is restored is refused at the next try.
    const rulesets = await rulesetsOfBoutsPutBack(this.supabase.service, [
      { match_id: matchId, previous_match_state: previousMatch },
    ]);

    // Un-advance BEFORE restoring the match, while the winner this forfeit
    // propagated is still on the row that names it — `downstreamSlots` reads the
    // match to resolve its slot. Clearing the fed sides is what lets the replayed
    // bout advance its real winner. Skipped for a pool match, which feeds none.
    // (The header says why this is hand-rolled rather than routed through the owner.)
    await this.bracketAdvance?.clearDownstreamOf(matchId);

    await restoreMatchState(this.supabase.service, matchId, previousMatch, rulesets);
    await this.readvanceIfDecided(matchId, previousMatch);

    const updated = await stampForfeitVoided(this.supabase.service, forfeitId, actor);
    await reopenClockTakenBack(this.boutDeps, matchId, previousMatch);
    await readSheetAgain(this.boutDeps, matchId, previousMatch);
    // The bout put back reads its copy before its write (R3).
    if (rulesets.size > 0)
      await restampAfterInsert(this.supabase.service, { matchId }, this.logger);
    // The status follows what is still live: no status this record found is written back, and
    // the Fighter's Pool bouts follow it. When the Fighter comes back in, the bouts forfeited
    // because they were out come back with them; while another cause holds them out, those bouts
    // stay forfeited. Last, so a settle that fails leaves the take-back whole; its retry settles.
    const settled = opts.settledByCaller
      ? null
      : await this.settleFighterOf(forfeit, actor, undefined, true);
    return { ...(updated ?? {}), cascaded_forfeit_count: settled?.broughtBack ?? 0 };
  }

  /** The record a take-back names, when it still stands. */
  private async standingForfeit(forfeitId: string, actor: Actor, opts: VoidOptions): Promise<Row> {
    const { data } = await this.supabase.service
      .from('match_forfeits')
      .select('*')
      .eq('id', forfeitId)
      .maybeSingle();
    if (!data) throw new NotFoundException(`Forfeit ${forfeitId} not found`);
    const forfeit = data as Row;
    if (forfeit['voided_at']) {
      // A retry of a take-back whose first send stopped after the stamp, before the settle.
      if (!opts.settledByCaller) await this.settleFighterOf(forfeit, actor, undefined, true);
      throw new BadRequestException('Forfeit is already voided');
    }
    return forfeit;
  }

  /**
   * The status settle of a record's Fighter, after its own write; their Pool and Swiss bouts follow
   * it. A Pool or Swiss bout the record completed is handed to the completion owner after them
   * (ruling 109), by its unit: its Swiss round, else its Pool phase. A bout its take-back put back
   * is forfeited again by the other Fighter on it, when they are out.
   */
  private settleFighterOf(
    forfeit: Row,
    actor: Actor,
    completedIn?: { id: string; type: string; swissRoundId: string | null },
    putBack = false,
  ) {
    const completedBout =
      completedIn && isPoolOrSwissPhase(completedIn.type)
        ? {
            matchId: forfeit['match_id'] as string,
            unitId: completedIn.swissRoundId ?? completedIn.id,
          }
        : undefined;
    const input: SettleInput = {
      registrationId: forfeit['forfeiting_registration_id'] as string,
      tournamentId: forfeit['tournament_id'] as string,
      actor: { userId: actor.userId, staffAccountId: actor.staffAccountId },
      completedBout,
      boutsPutBack: putBack ? [forfeit['match_id'] as string] : undefined,
    };
    return this.fighterStatus.settle(input);
  }

  /** The settle of a retry, when the live record on its bout is this Fighter's. */
  private async settleIfTheirs(
    active: Row | null,
    registrationId: string,
    actor: Actor,
    phase: { id: string; type: string; swissRoundId: string | null },
  ): Promise<void> {
    if (active?.['forfeiting_registration_id'] === registrationId) {
      await this.settleFighterOf(active, actor, phase);
    }
  }

  private get boutDeps(): BoutDeps {
    return {
      db: this.supabase.service,
      clock: this.clock,
      scoring: this.scoring,
      logger: this.logger,
    };
  }

  /**
   * Re-propagate a restored result that was already decided.
   *
   * The clear above un-advanced whoever the voided record sent through, and on
   * the normal path nothing needs to put anyone back: the bout returns to
   * un-completed, gets replayed, and completion advances the real winner. But
   * voiding an OVERRIDE on a match that had been completed by play restores a
   * finished result with a winner, and that path never re-advances — so the
   * downstream slot stayed empty and the bracket stalled on a result it already
   * had. Advancement fills a side only while it is null, which is exactly what
   * the clear just made it.
   */
  private async readvanceIfDecided(matchId: string, previous: Row): Promise<void> {
    if (previous['status'] !== 'completed' || !previous['winner_registration_id']) return;
    await this.matchCompletion?.onMatchCompleted(matchId);
  }

  /**
   * Every reason this write can be refused before anything is inserted.
   *
   * An override's whole purpose is a match that has already ended, so
   * `completed` is a reason to run it rather than to refuse it. A forfeit still
   * needs a live bout, and `voided` is closed to both.
   *
   * The lock and freeze checks are NOT inherited from the sibling write paths —
   * they have to be stated here. Every other writer on a match enforces them
   * (`clock.service.ts`, `matches.service.ts`, `penalties.service.ts`), and the
   * omission was harmless only while this service could not touch a completed
   * match. An override targets exactly the completed matches that auto-lock
   * stamps and that a finished event freezes, so without these two an
   * auto-locked result could be rewritten by a PIN scorer who cannot void a
   * single exchange on the same bout, and a frozen event could be edited
   * around the exchange-edit-request review that exists to record such changes.
   */
  private async assertWritable(
    matchId: string,
    match: {
      status?: unknown;
      locked_at?: unknown;
      red_registration_id?: unknown;
      blue_registration_id?: unknown;
    },
    dto: CreateMatchForfeitDto,
    actor: Actor,
  ): Promise<void> {
    const wasCompleted = match.status === 'completed';
    if (match.status === 'voided' || (wasCompleted && !isOverrideReason(dto.reason))) {
      // A retry of a forfeit whose first send closed the bout and stopped there settles.
      await this.settleIfTheirs(
        await this.loadActiveForfeit(matchId),
        dto.forfeitingRegistrationId,
        actor,
        this.phase(match as Row),
      );
      throw new BadRequestException('Match is already closed');
    }
    // `loadMatch` selects *, so locked_at is already on the row — no extra read.
    if (match.locked_at && !actor.canOverrideLocked) {
      throw matchLocked();
    }
    await this.frozenResults?.assertResultMutationAllowed(matchId, actor.userId);
    if (wasCompleted) await this.assertNoStartedDependents(matchId);
    if (
      ![match.red_registration_id, match.blue_registration_id].includes(
        dto.forfeitingRegistrationId,
      )
    ) {
      throw new BadRequestException('Forfeiting registration must belong to the current match');
    }
  }

  /**
   * Refuse an override once the old result has been built on.
   *
   * Voiding already refuses this — restoring a superseded winner would leave
   * the bracket describing a match that never happened. Overriding a COMPLETED
   * match rewrites the same winner, so it owes the same guard; without it the
   * two halves of one rule disagreed, and only the reversible half enforced it.
   *
   * Dependents come from BracketAdvanceService, which resolves them with the
   * ref algebra advancement itself uses.
   */
  private async assertNoStartedDependents(matchId: string): Promise<void> {
    const downstreamIds = (await this.bracketAdvance?.findDownstreamMatchIds(matchId)) ?? [];
    await this.assertNoneStarted(
      downstreamIds,
      'Cannot override a result after a dependent match has started',
    );
  }

  /**
   * The write-half guards, applied to the undo.
   *
   * Symmetry is the rule: a result an actor may not write is a result they may
   * not erase either. `assertWritable` reads the match row it already has;
   * this one has to fetch it, which is why the two are not one function.
   */
  private async assertVoidable(matchId: string, actor: Actor): Promise<void> {
    await this.frozenResults?.assertResultMutationAllowed(matchId, actor.userId);
    const { data } = await this.supabase.service
      .from('matches')
      .select('locked_at')
      .eq('id', matchId)
      .maybeSingle();
    if ((data as Row | null)?.['locked_at'] && !actor.canOverrideLocked) {
      throw matchLocked();
    }
  }

  /**
   * The bout must still be holding the result this record produced.
   *
   * `assertVoidable` asks whether the ACTOR may void. This asks whether there is
   * still the same thing to void. Two routes put a forfeited bout back in play
   * with its record active, reset and the clock's reopen (`PATCH /status` no
   * longer does, ruling 338), and one taken back so and then fought to a finish is
   * `completed` again, so no status-shaped check notices. Restoring
   * `previous_match_state` over it writes the pre-forfeit snapshot straight over
   * a real played result and the scores are gone.
   *
   * Refuse rather than guess: the organiser can reset the bout themselves if the
   * replay is the result they meant to discard.
   */
  private async assertMatchStillHoldsRecordedResult(matchId: string, forfeit: Row): Promise<void> {
    if ((await recordedResultDiverged(this.supabase.service, matchId, forfeit)) !== true) return;
    throw new BadRequestException(
      'Cannot void this record — the match has been replayed since it was created',
    );
  }

  /**
   * Refuse when any of these bouts has been fought.
   *
   * Routed through `hasBeenFought` rather than spelling the statuses again, and
   * excluding voided at the query the way its two other callers do — a voided
   * bout carries no live result, so it is not a reason to refuse.
   *
   * Both changes are answer-preserving: 'voided' was never in the status set
   * this used, and `started_at` cannot disagree with the status test on a row
   * this codebase can write. See the note in fought-match.ts.
   */
  private async assertNoneStarted(matchIds: string[], message: string): Promise<void> {
    if (matchIds.length === 0) return;
    const { data } = await this.supabase.service
      .from('matches')
      .select('id, status, started_at')
      .in('id', matchIds)
      .not('status', 'eq', 'voided');
    const started = (data ?? []).some((row) =>
      hasBeenFought(
        String((row as Row)['status']),
        ((row as Row)['started_at'] as string | null) ?? null,
      ),
    );
    if (started) throw new BadRequestException(message);
  }

  /** A bout the withdrawal forfeits with it, scored as the root's reason scores (ruling 69). */
  /**
   * The bracket half of a forfeit, once the replacement question is settled.
   *
   * The replacement is decided by the caller BEFORE the bout is completed — see
   * `createForfeit` — so by here it is a fact, not a branch to evaluate. When
   * one applies the bout was never completed, so there is nothing to advance and
   * nothing downstream: record the reserve and stop.
   */
  private async applyBracketOutcome(
    match: Row,
    phase: { type: string },
    forfeitId: string,
    ctx: { wasCompleted: boolean; replacementRegistrationId: string | null; now: string },
  ): Promise<string[]> {
    if (ctx.replacementRegistrationId) {
      await this.supabase.service
        .from('match_forfeits')
        .update({
          replacement_registration_id: ctx.replacementRegistrationId,
          updated_at: ctx.now,
        })
        .eq('id', forfeitId);
      return [];
    }

    // Overriding a completed bracket match changes who advanced. Advancement
    // fills a downstream side only while it is null — the property that makes it
    // idempotent — so without clearing first, re-advancing is a silent no-op and
    // the bracket keeps carrying the previous winner.
    if (ctx.wasCompleted) await this.bracketAdvance?.clearDownstreamOf(match['id'] as string);

    const downstreamIds: string[] = [];
    if (phase.type === 'single_elim' || phase.type === 'double_elim') {
      await this.matchCompletion?.onMatchCompleted(match['id'] as string);
    }

    // The matches this one FEEDS — resolved after advancement has filled them,
    // by the same ref algebra advancement used. This used to push the match's
    // OWN id, which made `downstream_match_ids` a list containing self: void
    // then handed it to a started-check whose set includes 'completed', and
    // completeMatch had just set this very match to completed. Every bracket
    // forfeit and every bracket override was therefore permanently unvoidable
    // — the guard fired on the match being voided. This list has exactly one
    // reader (that guard), so the self-id served no other purpose.
    downstreamIds.push(
      ...((await this.bracketAdvance?.findDownstreamMatchIds(match['id'] as string)) ?? []),
    );
    return downstreamIds;
  }

  private async tryReplaceMainRoundOneFighter(
    match: Row,
    forfeitingRegistrationId: string,
    reason: ForfeitReason,
  ): Promise<string | null> {
    // Replacing a no-show with a reserve is a FORFEIT remedy: "the bout never
    // started, so the empty slot gets the next fighter in". An override states
    // what a bout's result WAS — substituting a different fighter would discard
    // the correction being written, and `voidForfeit` never reverts
    // `bracket_slots`, so the reserve would stay in the bracket even after a
    // void.
    if (isOverrideReason(reason)) return null;
    // `match` is the row as it stands NOW: the caller resolves this before
    // completing the bout, so `scheduled` genuinely means unplayed rather than
    // "unplayed a moment ago, according to a snapshot".
    if (match['status'] !== 'scheduled' || !match['bracket_slot_id']) return null;

    const { data: slot } = await this.supabase.service
      .from('bracket_slots')
      .select(
        'id, phase_id, round, source_a_type, source_b_type, registration_a_id, registration_b_id',
      )
      .eq('id', match['bracket_slot_id'] as string)
      .maybeSingle();
    const bracketSlot = slot as Row | null;
    if (!bracketSlot || bracketSlot['round'] !== 1) return null;
    if (
      bracketSlot['source_a_type'] === 'winner_of' ||
      bracketSlot['source_b_type'] === 'winner_of'
    ) {
      return null;
    }

    const replacementId = await this.findNextReplacementRegistration(
      this.phase(match).tournament_id,
      bracketSlot['phase_id'] as string,
    );
    if (!replacementId) return null;

    const forfeitsOnA = bracketSlot['registration_a_id'] === forfeitingRegistrationId;
    await this.supabase.service
      .from('bracket_slots')
      .update(
        forfeitsOnA
          ? { registration_a_id: replacementId, updated_at: new Date().toISOString() }
          : { registration_b_id: replacementId, updated_at: new Date().toISOString() },
      )
      .eq('id', bracketSlot['id'] as string);

    // The fighter, and nothing else. This used to reset status/scores/winner as
    // well, because it ran AFTER `completeMatch` and had to undo it — which made
    // it an un-completion outside `MatchCompletionService`. The bout is now
    // never completed in the first place, so there is nothing to put back and
    // the guard above is the only thing deciding it.
    const side = forfeitsOnA ? 'red_registration_id' : 'blue_registration_id';
    await this.supabase.service
      .from('matches')
      .update({ [side]: replacementId, updated_at: new Date().toISOString() })
      .eq('id', match['id'] as string);

    return replacementId;
  }

  private async findNextReplacementRegistration(
    tournamentId: string,
    phaseId: string,
  ): Promise<string | null> {
    const { data: slots } = await this.supabase.service
      .from('bracket_slots')
      .select('registration_a_id, registration_b_id')
      .eq('phase_id', phaseId);
    const used = new Set<string>();
    for (const slot of slots ?? []) {
      const row = slot as Row;
      if (typeof row['registration_a_id'] === 'string') used.add(row['registration_a_id']);
      if (typeof row['registration_b_id'] === 'string') used.add(row['registration_b_id']);
    }

    const { data: registrations } = await this.supabase.service
      .from('registrations')
      .select('id, status, seed, bib_number')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in', 'done'])
      .order('seed', { ascending: true, nullsFirst: false });

    for (const registration of registrations ?? []) {
      const row = registration as Row;
      const id = row['id'] as string;
      if (!used.has(id)) return id;
    }
    return null;
  }

  /**
   * The rules a forfeit recorded by hand is recorded by, in one read of the
   * Tournament's card rules: its forfeit rules and, for a black card, what that
   * card does (rulings 58, 82). Stored rules that do not parse refuse it, worded.
   */
  private async handForfeitRules(tournamentId: string, reason: string): Promise<ForfeitInForce> {
    try {
      const { forfeitRules } = await cardAndForfeitRules(this.supabase.service, tournamentId);
      const cardEffect = isBlackCardReason(reason) ? blackCardEffectOf(forfeitRules, reason) : null;
      return { rules: forfeitRules, cardEffect };
    } catch (error) {
      throw forfeitRulesRefusal(error);
    }
  }

  /**
   * What the forfeit's reason does to the Fighter. A black card's is its card
   * rule's, never the scoring rules' (rulings 54, 58 and 82): 'tournament'
   * disqualifies, 'match' and 'none' end the bout only.
   */
  private reasonState(
    reason: string,
    policyState: string,
    cardEffect: BlackCardEffect | null,
  ): string {
    if (!isBlackCardReason(reason)) return policyState;
    return cardEffect === 'tournament' ? 'disqualified' : 'match_only';
  }

  /**
   * Apply the forfeit rules' two escalations to a forfeit's resulting state.
   *
   * - `disqualifyBeforeFirstBout` — "a forfeit before the 1st bout
   *   disqualifies". A registration id is tournament-scoped, so counting that
   *   fighter's completed matches needs no tournament filter.
   * - `disqualifyAfter` — "Disqualify after N forfeits". Counts the forfeits the
   *   Fighter chose: no black card, and no bout under what held them out — as the
   *   status settle counts (0242).
   *
   * A black card escalates neither (ruling 56). Counted before the new forfeit
   * row is inserted, hence the `+ 1`.
   *
   * `state` drives today's Pool cascade; `stored` is what the record keeps as its own effect
   * (`fighter_outcome`). The 1st escalation is stored; the 2nd never is: the status settle counts
   * the live forfeits every time, so a void counts again (ruling 80).
   */
  private async escalateTournamentState(
    registrationId: string,
    matchId: string,
    tournamentId: string,
    state: string,
    rules: ForfeitRules,
    reason: ForfeitReason,
  ): Promise<{ state: string; stored: string }> {
    const kept = { state, stored: state };
    if (state === 'disqualified') return kept;
    // The Fighter did not choose a black card: its own rule says what it does.
    if (isBlackCardReason(reason)) return kept;

    if (rules.disqualifyBeforeFirstBout) {
      const { count } = await this.supabase.service
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .neq('id', matchId)
        .or(`red_registration_id.eq.${registrationId},blue_registration_id.eq.${registrationId}`);
      if ((count ?? 0) === 0) return { state: 'disqualified', stored: 'disqualified' };
    }

    const threshold = rules.disqualifyAfter;
    if (threshold !== 'off') {
      const { count } = await this.supabase.service
        .from('match_forfeits')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('forfeiting_registration_id', registrationId)
        .in('reason', COUNTED_FORFEIT_REASONS)
        // The bouts under what held the Fighter out, forfeited with it or recorded again since,
        // are its effects, not forfeits (rulings 56, 89, 118 and 120). A bout taken out under
        // the hand, a card or a review hangs off no record: `auto_created` names it.
        .is('parent_forfeit_id', null)
        .eq('auto_created', false)
        .eq('under_out_status', false)
        .is('voided_at', null);
      if ((count ?? 0) + 1 >= threshold) return { state: 'disqualified', stored: state };
    }

    return kept;
  }

  /**
   * A rule that asks takes the answer on a Pool or Swiss bout only (ruling 76). On a bracket bout
   * the Fighter continues in the Tournament, and no status is written.
   */
  private resolveCanContinue(
    state: string,
    input: boolean | undefined,
    phaseType: string,
  ): boolean | null {
    if (state === 'ask') return asksInPhase(phaseType) ? (input ?? true) : true;
    if (state === 'match_only') return true;
    return false;
  }

  private async insertForfeit(row: Row): Promise<Row> {
    const { data, error } = await insertForfeit(this.supabase.service, row);
    if (error) throw new BadRequestException(error.message);
    return data ?? row;
  }

  private async loadActiveForfeit(matchId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('match_forfeits')
      .select('*')
      .eq('match_id', matchId)
      .is('voided_at', null)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private async loadMatch(matchId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('matches')
      .select('*, phases(id, type, tournament_id, config_json)')
      .eq('id', matchId)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  /** The bout's phase, and its Swiss round when it has one (`loadMatch` selects `*`). */
  private phase(match: Row) {
    const phase = Array.isArray(match['phases']) ? match['phases'][0] : match['phases'];
    return {
      ...(phase as { id: string; type: string; tournament_id: string }),
      swissRoundId: (match['swiss_round_id'] as string | null | undefined) ?? null,
    };
  }
}
