import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  FORFEIT_REASONS,
  isOverrideReason,
  resolveForfeitPolicy,
  type ForfeitReason,
} from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
// Value import ON PURPOSE — `import type` erases DI metadata and @Optional()
// silently injects undefined (see di-wiring.regression.test.ts).
import { MatchCompletionService } from '../phases/match-completion.service';
import { BracketAdvanceService } from '../phases/bracket-advance.service';
import type { CreateMatchForfeitDto } from './dto/matches.dto';
import { ClockService } from './clock.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import { forfeitEndReason } from './forfeit-end-reason';

/**
 * `canOverrideLocked` comes from `authorizeMatchScoring` and was being dropped
 * on the floor: the controller has always passed the full ScoringActor, and
 * this type simply did not declare the flag, so the lock could not be honoured
 * even in principle.
 */
type Actor = { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean };
type Row = Record<string, unknown>;

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
  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly matchCompletion?: MatchCompletionService,
    // Optional so direct `new MatchForfeitsService(supabase)` in tests still
    // works; in the app it's provided by MatchesModule (Supabase-only dep).
    @Optional() private readonly clock?: ClockService,
    @Optional() private readonly bracketAdvance?: BracketAdvanceService,
    @Optional() private readonly frozenResults?: FrozenResultsGuard,
  ) {}

  async createForfeit(matchId: string, dto: CreateMatchForfeitDto, actor: Actor = {}) {
    const match = await this.loadMatch(matchId);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);

    const wasCompleted = match.status === 'completed';
    await this.assertWritable(matchId, match, dto, actor);

    const active = await this.existingRecord(matchId, dto);
    if (active) return active;

    const phase = this.phase(match);
    const tournament = this.tournament(match);
    const policy = resolveForfeitPolicy(
      tournament.ruleset_config ?? {},
      dto.reason as ForfeitReason,
    );
    const winnerRegistrationId =
      dto.forfeitingRegistrationId === match.red_registration_id
        ? match.blue_registration_id
        : match.red_registration_id;

    // tournamentPolicy can escalate the per-reason state to a disqualification.
    // Resolved BEFORE canContinue, because a DQ implies the fighter cannot
    // continue (which in pools also auto-forfeits their remaining matches).
    const tournamentState = await this.escalateTournamentState(
      dto.forfeitingRegistrationId,
      matchId,
      phase.tournament_id,
      policy.tournamentState,
      tournament.ruleset_config,
      dto.reason as ForfeitReason,
    );

    const canContinue = this.resolveCanContinue(tournamentState, dto.canContinue);
    const scores = this.resolveScores(
      match,
      dto.forfeitingRegistrationId,
      policy,
      dto.explicitScores,
    );
    const now = new Date().toISOString();
    const priorRegistration = await this.loadRegistration(dto.forfeitingRegistrationId);
    const inheritedParentId = await this.resolveInheritedParentId(matchId, match, dto, phase);

    const forfeit = await this.insertForfeit({
      match_id: matchId,
      parent_forfeit_id: inheritedParentId,
      tournament_id: phase.tournament_id,
      forfeiting_registration_id: dto.forfeitingRegistrationId,
      winner_registration_id: winnerRegistrationId,
      reason: dto.reason,
      score_policy: policy.scorePolicy,
      forfeiting_score: scores.forfeitingScore,
      opponent_score: scores.opponentScore,
      can_continue: canContinue,
      auto_created: false,
      previous_match_state: this.matchSnapshot(match),
      previous_registration_state: priorRegistration ?? {},
      note: dto.note ?? null,
      by_user_id: actor.userId ?? null,
      staff_account_id: actor.staffAccountId ?? null,
    });

    await this.completeMatch(
      matchId,
      dto.forfeitingRegistrationId,
      winnerRegistrationId as string,
      scores,
      forfeitEndReason(dto.reason),
      now,
    );
    await this.applyTournamentState(dto.forfeitingRegistrationId, tournamentState, canContinue);

    // A pool match feeds no bracket slot, so a pool forfeit has no dependents
    // and this list stays empty. It used to hold the auto-forfeited CHILD match
    // ids — whose one reader is `assertNoneStarted`, whose started-set includes
    // 'completed', and `createAutoForfeit` had just completed every one of them.
    // Every cascading pool forfeit was therefore permanently unvoidable, and
    // `existingRecord` 409s the retry, so there was no product-reachable remedy
    // at all. The children are EFFECTS of this forfeit, not dependents of it;
    // they are reached through `parent_forfeit_id` — see `cascadeVoidChildren`.
    const downstreamIds: string[] = [];
    if (phase.type === 'pool' && canContinue === false) {
      await this.autoForfeitFuturePoolMatches(
        match,
        dto.forfeitingRegistrationId,
        dto.reason as ForfeitReason,
        // FLATTENED, not `forfeit.id`. `parent_forfeit_id` means "the root
        // withdrawal" and nothing else: `cascadeVoidChildren` is one query
        // deep, so a tree of depth 2 would leave the grandchildren active
        // when the root is voided — the exact class 0178 exists to kill.
        inheritedParentId ?? (forfeit.id as string),
        phase.tournament_id,
        tournament.ruleset_config ?? {},
        actor,
      );
    }

    if (phase.type !== 'pool') {
      // Overriding a completed bracket match changes who advanced. Advancement
      // fills a downstream side only while it is null — the property that makes
      // it idempotent — so without clearing first, re-advancing is a silent
      // no-op and the bracket keeps carrying the previous winner.
      if (wasCompleted) await this.bracketAdvance?.clearDownstreamOf(matchId);

      const bracketResult = await this.applyBracketForfeit(
        match,
        phase,
        dto.forfeitingRegistrationId,
        dto.reason as ForfeitReason,
      );
      downstreamIds.push(...bracketResult.downstreamIds);
      if (bracketResult.replacementRegistrationId) {
        await this.supabase.service
          .from('match_forfeits')
          .update({
            replacement_registration_id: bracketResult.replacementRegistrationId,
            downstream_match_ids: downstreamIds,
            updated_at: now,
          })
          .eq('id', forfeit.id as string);
      }
    }

    if (downstreamIds.length > 0) {
      await this.supabase.service
        .from('match_forfeits')
        .update({ downstream_match_ids: downstreamIds, updated_at: now })
        .eq('id', forfeit.id as string);
    }

    // Last, once every branch above has had its say about the matches row.
    await this.stampResultingState(forfeit.id as string, matchId);

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
   * The live ROOT withdrawal this new record belongs under, or null.
   *
   * The case: an injury withdraws a fighter mid-pool and auto-forfeits their
   * remaining bouts as children of that record. The organiser voids ONE child
   * to put that bout back on, and a fresh forfeit is written on it later.
   * Without this the new row is a root of its own, so voiding the injury no
   * longer sweeps it up and the fighter returns carrying an F that names a
   * withdrawal nothing points at.
   *
   * Read PRESENT STATE, never the void history. A parent that was voided and
   * re-recorded is a DIFFERENT row, and it is the new one that has the fighter
   * withdrawn; the voided one names a withdrawal that no longer exists.
   *
   * Scoped to the same pool because that is the reach of the cascade that made
   * the gap — `autoForfeitFuturePoolMatches` selects on `pool_id`, so a
   * withdrawal recorded in another pool never closed this bout.
   *
   * Served by `match_forfeits_tournament_idx` (0032), which is already partial
   * on `voided_at IS NULL`. No migration.
   */
  private async resolveInheritedParentId(
    matchId: string,
    match: Row,
    dto: CreateMatchForfeitDto,
    phase: { tournament_id: string },
  ): Promise<string | null> {
    // NEVER for an override. An override asserts the bout WAS fought and the
    // result was X; hanging it off a withdrawal would let voiding that
    // withdrawal erase a result an organiser stated.
    if (isOverrideReason(dto.reason)) return null;
    const poolId = match['pool_id'];
    if (typeof poolId !== 'string') return null;

    const { data } = await this.supabase.service
      .from('match_forfeits')
      // `pool_id` lives on the match, not on this table, so the scope goes
      // through an `!inner` embed — a direct .eq('pool_id') 400s.
      .select('id, matches!inner(pool_id)')
      .eq('tournament_id', phase.tournament_id)
      .eq('forfeiting_registration_id', dto.forfeitingRegistrationId)
      // Roots only, and only a record that actually withdrew the fighter — a
      // one-bout forfeit closed nothing else and adopts nothing.
      .is('parent_forfeit_id', null)
      .eq('can_continue', false)
      .is('voided_at', null)
      .eq('matches.pool_id', poolId)
      .neq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(1);
    const root = (data ?? [])[0] as Row | undefined;
    return (root?.['id'] as string | undefined) ?? null;
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
   */
  async voidForfeit(forfeitId: string, actor: Actor = {}) {
    const { data } = await this.supabase.service
      .from('match_forfeits')
      .select('*')
      .eq('id', forfeitId)
      .maybeSingle();
    if (!data) throw new NotFoundException(`Forfeit ${forfeitId} not found`);
    const forfeit = data as Row;
    if (forfeit['voided_at']) throw new BadRequestException('Forfeit is already voided');

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

    // Un-advance BEFORE restoring the match, while the winner this forfeit
    // propagated is still on the row that names it — `downstreamSlots` reads
    // the match to resolve its slot. Clearing the fed sides is what lets the
    // replayed bout advance its real winner. Skipped for a pool match, which
    // feeds no slots.
    await this.bracketAdvance?.clearDownstreamOf(matchId);

    const previousMatch = (forfeit['previous_match_state'] as Row | null) ?? {};
    await this.restoreMatchState(matchId, previousMatch);
    await this.readvanceIfDecided(matchId, previousMatch);

    const previousReg = (forfeit['previous_registration_state'] as Row | null) ?? {};
    if (previousReg['status']) {
      await this.supabase.service
        .from('registrations')
        .update({ status: previousReg['status'] })
        .eq('id', forfeit['forfeiting_registration_id'] as string);
    }

    // Children second-to-last, the parent LAST. A crash between them leaves the
    // parent record active, so a re-run converges: the children already voided
    // drop out of `cascadeVoidChildren`'s query. Stamping the parent first would
    // strand them forfeited with no reachable remedy, because `existingRecord`
    // would no longer block a fresh record on the parent match.
    const cascaded = await this.cascadeVoidChildren(forfeitId, actor);
    const updated = await this.stampVoided(forfeitId, actor);
    return { ...(updated ?? {}), cascaded_forfeit_count: cascaded };
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
   * Void the sub-forfeits this record cascaded into the fighter's remaining
   * pool matches.
   *
   * Voiding the parent un-withdraws the fighter — `previous_registration_state`
   * puts their `registrations.status` back — so leaving their other bouts on
   * record as forfeits would count F's in the standings for someone who is back
   * in the tournament. `pool-standings.service.ts` and `swiss-standings-loader`
   * both key on `voided_at IS NULL` and nothing else, so stamping the child is
   * what removes the F; restoring its match is what puts the bout back on.
   *
   * No registration restore for a child: its `previous_registration_state` is
   * `{}` by construction and the PARENT owns the fighter's status. No
   * `clearDownstreamOf` either — a pool match feeds no slot.
   *
   * A child already voided is SKIPPED. The organiser dealt with that bout
   * separately and whatever was replayed on it afterwards is a real result;
   * refusing the parent void over it would reinstate the bug being fixed here.
   * That predicate is also what makes a re-run after a mid-way crash converge.
   */
  private async cascadeVoidChildren(parentForfeitId: string, actor: Actor): Promise<number> {
    const { data } = await this.supabase.service
      .from('match_forfeits')
      .select('id, match_id, previous_match_state')
      .eq('parent_forfeit_id', parentForfeitId)
      .is('voided_at', null);
    const children = (data ?? []) as Row[];
    if (children.length === 0) return 0;

    const live = await this.liveMatchIds(children.map((child) => child['match_id'] as string));
    for (const child of children) {
      const matchId = child['match_id'] as string;
      // Two reasons to leave the bout alone, and the record voids either way.
      // `live` catches one mid-bout; the divergence check catches the case it
      // cannot see — a child reset and re-fought all the way to 'completed'
      // again, which is not 'running' or 'paused' and so reads as untouched.
      const diverged = await this.recordedResultDiverged(matchId, child);
      if (!live.has(matchId) && diverged !== true) {
        await this.restoreMatchState(matchId, (child['previous_match_state'] as Row | null) ?? {});
      }
      await this.stampVoided(child['id'] as string, actor);
    }
    return children.length;
  }

  /**
   * Which of these matches are mid-bout, so must not be rewritten.
   *
   * An auto-forfeited match is `completed`, but three live paths put one back in
   * play with its forfeit row still active: `POST /matches/:id/reset`,
   * `PATCH /matches/:id/status`, and the clock's `reopen` (which validates the
   * CLOCK state machine, never `matches.status`). Restoring
   * `previous_match_state` over a running bout would wipe its score.
   *
   * MID-BOUT ONLY. A child taken back through one of those paths and then fought
   * to a finish is `completed` again, which this set does not contain — the
   * caller pairs it with `recordedResultDiverged`, which compares the row to
   * what the record produced and so covers the finished case.
   *
   * The record still voids either way — an F must not stand for a bout that is
   * being fought for real. Scoped on `status`, NOT `started_at`:
   * `autoForfeitFuturePoolMatches` selects `.in('status', ['scheduled','paused'])`,
   * so a child auto-forfeited from `paused` has a non-null `started_at` and DOES
   * need restoring.
   */
  private async liveMatchIds(matchIds: string[]): Promise<Set<string>> {
    if (matchIds.length === 0) return new Set();
    const { data } = await this.supabase.service
      .from('matches')
      .select('id, status')
      .in('id', matchIds);
    return new Set(
      (data ?? [])
        .filter((row) => ['running', 'paused'].includes(String((row as Row)['status'])))
        .map((row) => (row as Row)['id'] as string),
    );
  }

  /**
   * Stamp the void columns. Shared so a cascaded child records the same audit
   * trail — who voided it and when — as the parent that carried it down.
   */
  private async stampVoided(forfeitId: string, actor: Actor): Promise<Row | null> {
    const now = new Date().toISOString();
    const { data } = await this.supabase.service
      .from('match_forfeits')
      .update({
        voided_at: now,
        voided_by_user_id: actor.userId ?? null,
        voided_by_staff_account_id: actor.staffAccountId ?? null,
        updated_at: now,
      })
      .eq('id', forfeitId)
      .select('*')
      .single();
    return (data as Row | null) ?? null;
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
      throw new BadRequestException('Match is already closed');
    }
    // `loadMatch` selects *, so locked_at is already on the row — no extra read.
    if (match.locked_at && !actor.canOverrideLocked) {
      throw new BadRequestException('Match is locked');
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
   * Put the match back the way `matchSnapshot` found it.
   *
   * Every column here has a counterpart in `matchSnapshot`, and the pair must
   * stay in step: a field the snapshot captures but this does not write stays
   * at whatever the forfeit set it to, silently. `end_reason` was exactly that
   * — see the note on `matchSnapshot`.
   */
  private async restoreMatchState(matchId: string, previous: Row): Promise<void> {
    await this.supabase.service
      .from('matches')
      .update({
        status: previous['status'] ?? 'scheduled',
        red_score: previous['red_score'] ?? 0,
        blue_score: previous['blue_score'] ?? 0,
        winner_registration_id: previous['winner_registration_id'] ?? null,
        ended_at: previous['ended_at'] ?? null,
        end_reason: previous['end_reason'] ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId);
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
      throw new BadRequestException('Match is locked');
    }
  }

  /**
   * The bout must still be holding the result this record produced.
   *
   * `assertVoidable` asks whether the ACTOR may void. This asks whether there is
   * still the same thing to void. Three routes put a forfeited bout back in play
   * with its record active — reset, `PATCH /status`, and the clock's reopen —
   * and a bout taken back through one of them and then fought to a finish is
   * `completed` again, so no status-shaped check notices. Restoring
   * `previous_match_state` over it writes the pre-forfeit snapshot straight over
   * a real played result and the scores are gone.
   *
   * Refuse rather than guess: the organiser can reset the bout themselves if the
   * replay is the result they meant to discard.
   */
  private async assertMatchStillHoldsRecordedResult(matchId: string, forfeit: Row): Promise<void> {
    if ((await this.recordedResultDiverged(matchId, forfeit)) !== true) return;
    throw new BadRequestException(
      'Cannot void this record — the match has been replayed since it was created',
    );
  }

  private async assertNoneStarted(matchIds: string[], message: string): Promise<void> {
    if (matchIds.length === 0) return;
    const { data } = await this.supabase.service
      .from('matches')
      .select('id, status')
      .in('id', matchIds);
    const started = (data ?? []).some((row) =>
      ['running', 'paused', 'completed'].includes(String((row as Row)['status'])),
    );
    if (started) throw new BadRequestException(message);
  }

  private async autoForfeitFuturePoolMatches(
    match: Row,
    registrationId: string,
    reason: ForfeitReason,
    parentForfeitId: string,
    tournamentId: string,
    rulesetConfig: unknown,
    actor: Actor,
  ): Promise<void> {
    const { data } = await this.supabase.service
      .from('matches')
      // winner_registration_id/ended_at/end_reason ride along for
      // `matchSnapshot`, which is what a cascade void restores from. Omitting
      // them made the snapshot record `null` for all three via its `?? null`
      // fallbacks rather than the row's real value — the same way `end_reason`
      // was lost on the parent (see the note on `matchSnapshot`). One string
      // literal, never concatenated: supabase-js infers the row type FROM the
      // select text, and a `+` collapses it to GenericStringError.
      .select(
        'id, red_registration_id, blue_registration_id, red_score, blue_score, status, winner_registration_id, ended_at, end_reason, phases(id, type, tournament_id, tournaments(id, ruleset_config))',
      )
      .eq('pool_id', match['pool_id'] as string)
      .in('status', ['scheduled', 'paused'])
      .or(`red_registration_id.eq.${registrationId},blue_registration_id.eq.${registrationId}`);

    for (const row of data ?? []) {
      const future = row as Row;
      if (future['id'] === match['id']) continue;
      await this.createAutoForfeit(
        future,
        registrationId,
        reason,
        parentForfeitId,
        tournamentId,
        rulesetConfig,
        actor,
      );
    }
  }

  private async createAutoForfeit(
    match: Row,
    registrationId: string,
    reason: ForfeitReason,
    parentForfeitId: string,
    tournamentId: string,
    rulesetConfig: unknown,
    actor: Actor,
  ): Promise<void> {
    const policy = resolveForfeitPolicy(rulesetConfig, reason);
    const winnerRegistrationId =
      registrationId === match['red_registration_id']
        ? (match['blue_registration_id'] as string)
        : (match['red_registration_id'] as string);
    const scores = this.resolveScores(match, registrationId, policy);

    const child = await this.insertForfeit({
      match_id: match['id'],
      tournament_id: tournamentId,
      forfeiting_registration_id: registrationId,
      winner_registration_id: winnerRegistrationId,
      reason,
      score_policy: policy.scorePolicy,
      forfeiting_score: scores.forfeitingScore,
      opponent_score: scores.opponentScore,
      can_continue: false,
      auto_created: true,
      parent_forfeit_id: parentForfeitId,
      previous_match_state: this.matchSnapshot(match),
      previous_registration_state: {},
      by_user_id: actor.userId ?? null,
      staff_account_id: actor.staffAccountId ?? null,
    });
    await this.completeMatch(
      match['id'] as string,
      registrationId,
      winnerRegistrationId,
      scores,
      forfeitEndReason(reason),
    );
    // A child is voided by the cascade, which compares the same way the parent
    // void does — so it owes the same recorded result.
    await this.stampResultingState(child.id as string, match['id'] as string);
  }

  private async applyBracketForfeit(
    match: Row,
    phase: { type: string },
    forfeitingRegistrationId: string,
    reason: ForfeitReason,
  ): Promise<{ downstreamIds: string[]; replacementRegistrationId?: string }> {
    const downstreamIds: string[] = [];
    const replacementRegistrationId = await this.tryReplaceMainRoundOneFighter(
      match,
      forfeitingRegistrationId,
      reason,
    );
    if (replacementRegistrationId) {
      return { downstreamIds, replacementRegistrationId };
    }

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
    return { downstreamIds };
  }

  private async tryReplaceMainRoundOneFighter(
    match: Row,
    forfeitingRegistrationId: string,
    reason: ForfeitReason,
  ): Promise<string | null> {
    // Replacing a no-show with a reserve is a FORFEIT remedy: "the bout never
    // started, so the empty slot gets the next fighter in". An override states
    // what a bout's result WAS — substituting a different fighter and resetting
    // the match to 0-0 discards the correction that was just written, and
    // `voidForfeit` never reverts `bracket_slots`, so the reserve would stay in
    // the bracket even after a void.
    if (isOverrideReason(reason)) return null;
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

    await this.supabase.service
      .from('matches')
      .update(
        forfeitsOnA
          ? {
              red_registration_id: replacementId,
              status: 'scheduled',
              winner_registration_id: null,
              ended_at: null,
              red_score: 0,
              blue_score: 0,
              updated_at: new Date().toISOString(),
            }
          : {
              blue_registration_id: replacementId,
              status: 'scheduled',
              winner_registration_id: null,
              ended_at: null,
              red_score: 0,
              blue_score: 0,
              updated_at: new Date().toISOString(),
            },
      )
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

  private resolveScores(
    match: Row,
    forfeitingRegistrationId: string,
    policy: { scorePolicy: string; lossScore: number; opponentScore: number },
    explicit?: { forfeitingScore: number; opponentScore: number },
  ) {
    const redForfeits = forfeitingRegistrationId === match['red_registration_id'];

    // An override states the result; there is nothing to derive. The DTO
    // guarantees the pair is present for an override reason and absent
    // otherwise, so a missing pair here would be a wiring bug, not input.
    if (policy.scorePolicy === 'explicit') {
      if (!explicit) {
        throw new BadRequestException('An override requires explicit scores');
      }
      return {
        redScore: redForfeits ? explicit.forfeitingScore : explicit.opponentScore,
        blueScore: redForfeits ? explicit.opponentScore : explicit.forfeitingScore,
        forfeitingScore: explicit.forfeitingScore,
        opponentScore: explicit.opponentScore,
      };
    }

    const currentForfeitingScore =
      Number(redForfeits ? match['red_score'] : match['blue_score']) || 0;
    const currentOpponentScore =
      Number(redForfeits ? match['blue_score'] : match['red_score']) || 0;
    return {
      redScore:
        policy.scorePolicy === 'keep_current'
          ? Number(match['red_score'] ?? 0)
          : redForfeits
            ? policy.lossScore
            : policy.opponentScore,
      blueScore:
        policy.scorePolicy === 'keep_current'
          ? Number(match['blue_score'] ?? 0)
          : redForfeits
            ? policy.opponentScore
            : policy.lossScore,
      forfeitingScore:
        policy.scorePolicy === 'keep_current' ? currentForfeitingScore : policy.lossScore,
      opponentScore:
        policy.scorePolicy === 'keep_current' ? currentOpponentScore : policy.opponentScore,
    };
  }

  private async completeMatch(
    matchId: string,
    _forfeitingRegistrationId: string,
    winnerRegistrationId: string,
    scores: { redScore: number; blueScore: number },
    endReason: string,
    endedAt = new Date().toISOString(),
  ) {
    await this.supabase.service
      .from('matches')
      .update({
        status: 'completed',
        ended_at: endedAt,
        winner_registration_id: winnerRegistrationId,
        red_score: scores.redScore,
        blue_score: scores.blueScore,
        // 'black_card' | 'forfeit' — lets the pad + TV label the result.
        end_reason: endReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId);

    // A forfeit ends the bout — stop the clock too so it freezes and the
    // scoreboard's clock-driven endcard fires. Best-effort: the match is
    // already completed, so a clock-end failure must not fail the forfeit.
    // Only running/halted clocks can 'end' (idle/ended throw → skipped).
    if (this.clock) {
      try {
        const clk = await this.clock.getClockState(matchId);
        if (clk.status === 'running' || clk.status === 'halted') {
          await this.clock.clockAction(matchId, 'end', 'auto: forfeit', {
            canOverrideLocked: true,
          });
        }
      } catch {
        // swallow — clock end is best-effort
      }
    }
  }

  private async applyTournamentState(
    registrationId: string,
    state: string,
    canContinue: boolean | null,
  ) {
    if (state === 'disqualified') {
      await this.supabase.service
        .from('registrations')
        .update({ status: 'disqualified' })
        .eq('id', registrationId);
    } else if (state === 'withdrawn' || canContinue === false) {
      await this.supabase.service
        .from('registrations')
        .update({ status: 'withdrawn' })
        .eq('id', registrationId);
    }
  }

  /**
   * Apply the two tournament-policy escalations to a forfeit's resulting state.
   * Both were stored and editable but read by nothing.
   *
   * - `forfeitFighterBefore1stMatch` — "Forfeit before 1st match → auto-DQ".
   *   A registration id is tournament-scoped, so counting that fighter's
   *   completed matches needs no tournament filter.
   * - `disqualifyAfter` — "Disqualify after N forfeits". Counts FORFEITS, not
   *   black cards; the per-reason `tournamentState` and the penalty ruleset's
   *   black-card scope both key off other things, so nothing counted these.
   *
   * Counted before the new forfeit row is inserted, hence the `+ 1`.
   */
  private async escalateTournamentState(
    registrationId: string,
    matchId: string,
    tournamentId: string,
    state: string,
    rulesetConfig: unknown,
    reason: ForfeitReason,
  ): Promise<string> {
    if (state === 'disqualified') return state;
    // Nobody forfeited, so neither escalation applies. Correcting a fighter's
    // first result must not disqualify them for "forfeiting before their 1st
    // match", and a correction must not count toward `disqualifyAfter`.
    if (isOverrideReason(reason)) return state;

    const policy =
      ((rulesetConfig as { tournamentPolicy?: Record<string, unknown> } | null) ?? {})
        .tournamentPolicy ?? {};

    if (policy['forfeitFighterBefore1stMatch'] === true) {
      const { count } = await this.supabase.service
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .neq('id', matchId)
        .or(`red_registration_id.eq.${registrationId},blue_registration_id.eq.${registrationId}`);
      if ((count ?? 0) === 0) return 'disqualified';
    }

    const threshold = policy['disqualifyAfter'];
    if (typeof threshold === 'number' && threshold > 0) {
      const { count } = await this.supabase.service
        .from('match_forfeits')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .eq('forfeiting_registration_id', registrationId)
        // Overrides share this table but are not forfeits — see FORFEIT_REASONS.
        .in('reason', FORFEIT_REASONS)
        .is('voided_at', null);
      if ((count ?? 0) + 1 >= threshold) return 'disqualified';
    }

    return state;
  }

  private resolveCanContinue(state: string, input: boolean | undefined): boolean | null {
    if (state === 'ask') return input ?? true;
    if (state === 'match_only') return true;
    return false;
  }

  private async insertForfeit(row: Row): Promise<Row> {
    const { data, error } = await this.supabase.service
      .from('match_forfeits')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return (data as Row | null) ?? row;
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
      .select('*, phases(id, type, tournament_id, config_json, tournaments(id, ruleset_config))')
      .eq('id', matchId)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private async loadRegistration(registrationId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('registrations')
      .select('id, status')
      .eq('id', registrationId)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private phase(match: Row) {
    const phase = Array.isArray(match['phases']) ? match['phases'][0] : match['phases'];
    return phase as { id: string; type: string; tournament_id: string; tournaments?: unknown };
  }

  private tournament(match: Row) {
    const phase = this.phase(match);
    const tournament = Array.isArray(phase.tournaments) ? phase.tournaments[0] : phase.tournaments;
    return (tournament ?? {}) as { id?: string; ruleset_config?: unknown };
  }

  private matchSnapshot(match: Row) {
    return {
      status: match['status'],
      red_score: match['red_score'],
      blue_score: match['blue_score'],
      winner_registration_id: match['winner_registration_id'] ?? null,
      ended_at: match['ended_at'] ?? null,
      // Whatever the snapshot omits, the void cannot restore. end_reason was
      // omitted and completeMatch overwrites it, so every void left the match
      // claiming it ended the way the voided record said it did.
      end_reason: match['end_reason'] ?? null,
    };
  }

  /** The six snapshot columns, read fresh. Null when the match is gone. */
  private async readMatchSnapshot(matchId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('matches')
      .select('status, red_score, blue_score, winner_registration_id, ended_at, end_reason')
      .eq('id', matchId)
      .maybeSingle();
    return data ? this.matchSnapshot(data as Row) : null;
  }

  /**
   * Record the result this forfeit produced, so a later void can tell whether
   * the match still holds it.
   *
   * Read fresh at the END of the write rather than copied from `completeMatch`'s
   * arguments, because `tryReplaceMainRoundOneFighter` can un-complete the row
   * again inside the same call — a bracket round-1 forfeit with a replacement
   * finishes `scheduled`, not `completed`. Whatever the row says once every
   * branch has run is what the record produced.
   */
  private async stampResultingState(forfeitId: string, matchId: string): Promise<void> {
    const resulting = await this.readMatchSnapshot(matchId);
    if (!resulting) return;
    await this.supabase.service
      .from('match_forfeits')
      .update({ resulting_match_state: resulting, updated_at: new Date().toISOString() })
      .eq('id', forfeitId);
  }

  /**
   * Has the match moved off the result this record produced?
   *
   * `null` when there is nothing to compare — a record written before migration
   * 0186 carries an empty object, and inventing a verdict there would refuse
   * voids on no evidence.
   *
   * `ended_at` is deliberately NOT compared. It round-trips through Postgres as
   * a timestamptz and comes back in a different string form than the ISO value
   * `completeMatch` wrote, so comparing it would report divergence on every
   * untouched row. The four decision columns are enough to separate a replay
   * from the forfeit's own result: a real fight writes `end_reason` from the
   * ruleset ('first_to_points', 'time_limit', 'max_doubles') or leaves it null,
   * never 'forfeit' or 'black_card'.
   */
  private async recordedResultDiverged(matchId: string, forfeit: Row): Promise<boolean | null> {
    const recorded = (forfeit['resulting_match_state'] as Row | null) ?? {};
    if (Object.keys(recorded).length === 0) return null;
    const current = await this.readMatchSnapshot(matchId);
    if (!current) return null;
    return RESULT_DECISION_KEYS.some((key) => (current[key] ?? null) !== (recorded[key] ?? null));
  }
}

/** What makes one result different from another. See `recordedResultDiverged`. */
const RESULT_DECISION_KEYS = [
  'status',
  'winner_registration_id',
  'red_score',
  'blue_score',
  'end_reason',
] as const;
