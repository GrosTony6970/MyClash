import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Value imports, not `import type`: Nest needs the runtime classes for DI metadata.
import { BracketAdvanceService } from './bracket-advance.service';
import { PhasesService } from './phases.service';
import { SwissAdvanceService } from '../swiss/swiss-advance.service';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { clearDependentPairing, dependentClosure, type DependentBout } from './bracket-dependents';
import { revertMatchToUnplayed } from './revert-match';

/** Who is asking, and what they have already agreed to lose. */
export interface UncompleteOptions {
  actor?: {
    userId?: string;
    staffAccountId?: string;
    /** Granted only by `authorizeMatchOrganizer` — org editor, admin or owner. */
    canDiscardDependentResults?: boolean;
  };
  /** The organiser has been shown the fought dependents and wants them wiped. */
  discardDependents?: boolean;
  /** Recorded on each reverted bout's `match_events` row. */
  reason?: string;
}

/**
 * The single owner of "a match just completed".
 *
 * A match can complete down four different paths — `PATCH /matches/:id/status`,
 * the ruleset engine closing on the point cap, the clock's `end` action, and a
 * forfeit — and each one needs the same side effects: advance the bracket,
 * (for a pool match) try to auto-populate the bracket now the pools may be
 * finished, and (for a Swiss match) pair the next round if this one just
 * closed.
 *
 * Wiring those by hand at each call site kept going wrong, silently, because a
 * missing call looks like nothing at all:
 *   - advancement was wired ONLY to the status endpoint and forfeits, so a
 *     bracket scored on the pad never advanced its winner;
 *   - after that was fixed, the auto-populate sibling sitting on the very next
 *     line was still missed, so scoring the last pool match on the pad left the
 *     bracket empty.
 *
 * Both are the same defect: side effects owned by call sites rather than by the
 * event. This service exists so there is exactly ONE thing to call.
 * `di-wiring.regression.test.ts` asserts every completion path calls it;
 * `match-completion.service.test.ts` asserts it then performs BOTH side effects.
 *
 * Deliberately a leaf: it depends on BracketAdvanceService and PhasesService and
 * nothing depends back on it. It cannot live on MatchesService, which already
 * injects ScoringService — injecting MatchesService into scoring would close a
 * cycle.
 */
@Injectable()
export class MatchCompletionService {
  private readonly logger = new Logger(MatchCompletionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    // NOT @Optional(), unlike its siblings. The other three degrade to a missing
    // side effect; this one degrades to a freeze that stops existing, which is
    // the worst shape a guard can take. It is reachable from here only because
    // FrozenResultsModule is a leaf — see its header.
    private readonly frozenResults: FrozenResultsGuard,
    @Optional() private readonly bracketAdvance?: BracketAdvanceService,
    @Optional() private readonly phases?: PhasesService,
    @Optional() private readonly swissAdvance?: SwissAdvanceService,
  ) {}

  /**
   * Run every side effect a completed match owes. Safe to call more than once
   * for the same match: advancement only fills slot sides that are still null,
   * and populateBracket's own gate makes a repeat a no-op.
   *
   * Never throws — a completion side effect must not fail the write that
   * triggered it (an exchange, a clock action, a status change).
   */
  async onMatchCompleted(matchId: string): Promise<void> {
    await this.advance(matchId);
    await this.maybePopulateBracket(matchId);
    await this.maybeAdvanceSwiss(matchId);
  }

  /**
   * The mirror: a match STOPPED being completed, so everything its result
   * produced has to stop standing.
   *
   * Advancement writes a downstream side only while it is null — the property
   * that makes re-advancing idempotent — so a stale side is permanent. Undo the
   * bout and nothing corrects it: replay it, let the other fighter win, and the
   * next round still carries the first one. Silently, for the rest of the event.
   *
   * THE ERROR CONTRACT IS DELIBERATELY THE OPPOSITE OF ITS SIBLING.
   * `onMatchCompleted` must never throw, because a side effect must not fail the
   * write that triggered it. This one MUST be able to refuse: a caller that
   * swallows a failure here leaves the bracket describing a match that did not
   * happen, which is worse than the write not going through. Call it BEFORE the
   * status write, so a refusal leaves nothing half-done — there is no
   * transaction through supabase-js, and ordering is the whole guarantee.
   *
   * THREE OUTCOMES.
   *   - No dependent has been fought: clear and return. Nothing is lost.
   *   - A dependent has been fought, `discardDependents` not set: refuse, naming
   *     the count. The caller is expected to have shown the operator the
   *     pre-flight first.
   *   - A dependent has been fought and an authorised organiser said yes: those
   *     bouts are reverted to unplayed too, deepest round first, and go back on
   *     the schedule to be re-fought. Completing this match again refills them
   *     through the ordinary advance path.
   *
   * WHAT IT DELIBERATELY DOES NOT DO. It never deletes a bout. The grand-final
   * reset is the one row created on demand rather than at generation time, and
   * `retractGrandFinalReset` removes it when a re-completion flips the result to
   * a winners-bracket win. Doing that here as well would hard-delete a reset
   * that was actually played, taking its exchanges, penalties and events with it
   * through ON DELETE CASCADE. Clearing is enough: the row survives as an empty
   * scheduled bout and the completion path decides its fate.
   */
  async onMatchUncompleted(matchId: string, opts: UncompleteOptions = {}): Promise<void> {
    // Once, on the root. The guard is per EVENT — it walks match → phase →
    // tournament → event — and every dependent is in the same phase, so asking
    // per bout would be 5N sequential reads for one answer. It also throws, and
    // a throw from inside the revert loop leaves a half-applied cascade.
    await this.frozenResults.assertResultMutationAllowed(matchId, opts.actor?.userId);

    const dependents = await dependentClosure(this.supabase.service, matchId);
    const fought = dependents.filter((bout) => bout.hasBeenFought);

    if (fought.length > 0) {
      this.assertMayDiscard(fought, opts);
      const reason = opts.reason ?? 'result of an earlier bout was undone';
      // Deepest round first, which `dependentClosure` has already ordered. Every
      // edge increases the round, so a bout is reverted only after everything it
      // feeds — a crash part-way leaves a suffix reverted and converges on re-run.
      for (const bout of fought) {
        if (!bout.matchId) continue;
        await revertMatchToUnplayed(this.supabase.service, bout.matchId, reason, opts.actor ?? {});
      }
    }

    // The root's own fed sides, plus those of every bout the cascade reverted:
    // `clearDownstreamOf` reaches exactly one level, so applying it only at the
    // root would leave every deeper slot holding what its now-reverted parent
    // put there, and the permanent-stale-side bug simply moves a round along.
    // Bouts that were never fought propagated nothing, so they need no clear.
    await this.bracketAdvance?.clearDownstreamOf(matchId);
    for (const bout of fought) {
      if (bout.matchId) await this.bracketAdvance?.clearDownstreamOf(bout.matchId);
    }

    // And take the fighters off the dependent rows themselves — the slot clear
    // does not touch them, and until a re-completion happens they would keep
    // naming a pair that has not earned the bout.
    for (const bout of dependents) {
      if (bout.matchId) await clearDependentPairing(this.supabase.service, bout.matchId);
    }
  }

  /**
   * What un-completing this match would do, without doing any of it.
   *
   * A pure read. It never writes and never throws on the condition it reports —
   * including the frozen-results refusal, which becomes a `blockedReason` rather
   * than a 409, because the whole point is that the operator sees the answer
   * BEFORE pressing anything. Modelled on `getRecomputePreflight`.
   *
   * Names, never ids. `vw_tournament_query_matches` already projects the two
   * fighter names and the bout's label, so the affected list reads as bouts an
   * organiser recognises rather than a column of UUIDs.
   */
  async previewUncompletion(matchId: string, actor?: UncompleteOptions['actor']) {
    const dependents = await dependentClosure(this.supabase.service, matchId);
    const fought = dependents.filter((bout) => bout.hasBeenFought);
    const named = await this.nameBouts(dependents);

    return {
      affected: dependents.map((bout) => ({
        label: named.get(bout.matchId ?? '')?.label ?? bout.label,
        redName: named.get(bout.matchId ?? '')?.redName ?? null,
        blueName: named.get(bout.matchId ?? '')?.blueName ?? null,
        round: bout.round,
        status: bout.status,
        hasBeenFought: bout.hasBeenFought,
        locked: bout.lockedAt !== null,
      })),
      foughtCount: fought.length,
      blocked: fought.length > 0,
      canDiscard: actor?.canDiscardDependentResults === true,
      frozen: await this.isFrozen(matchId, actor?.userId),
    };
  }

  /** `false` rather than a throw — a pre-flight reports, it does not refuse. */
  private async isFrozen(matchId: string, userId?: string): Promise<boolean> {
    try {
      await this.frozenResults.assertResultMutationAllowed(matchId, userId);
      return false;
    } catch {
      return true;
    }
  }

  private async nameBouts(bouts: DependentBout[]) {
    const ids = bouts.map((bout) => bout.matchId).filter((id): id is string => id !== null);
    const named = new Map<string, { label: string | null; redName: string; blueName: string }>();
    if (ids.length === 0) return named;

    const { data } = await this.supabase.service
      .from('vw_tournament_query_matches')
      .select('match_id, match_number_label, red_name, blue_name')
      .in('match_id', ids);

    for (const row of (data ?? []) as Array<Record<string, string | null>>) {
      named.set(row['match_id'] as string, {
        label: row['match_number_label'] ?? null,
        redName: row['red_name'] ?? '',
        blueName: row['blue_name'] ?? '',
      });
    }
    return named;
  }

  private assertMayDiscard(fought: DependentBout[], opts: UncompleteOptions): void {
    if (!opts.discardDependents) {
      throw new ConflictException({
        message:
          fought.length === 1
            ? 'A later bout has already been fought. Undoing this result would invalidate it.'
            : `${fought.length} later bouts have already been fought. Undoing this result would invalidate them.`,
        foughtCount: fought.length,
        code: 'dependent_results_would_be_discarded',
      });
    }
    if (!opts.actor?.canDiscardDependentResults) {
      throw new ForbiddenException(
        'Only an organiser can undo a result once a later bout has been fought',
      );
    }
  }

  private async advance(matchId: string): Promise<void> {
    try {
      await this.bracketAdvance?.onMatchCompleted(matchId);
    } catch (err) {
      // onMatchCompleted already swallows its own errors; this is belt-and-braces
      // so a future change there can never take the caller down with it.
      this.logger.warn(`Bracket advance after match ${matchId} failed: ${describe(err)}`);
    }
  }

  /**
   * After a SWISS match completes, pair the next round if this one just closed.
   *
   * A third side effect INSIDE the single owner, not a fifth call site: the
   * four completion paths are unchanged, which is what
   * di-wiring.regression.test.ts asserts. SwissAdvanceService swallows its own
   * errors and no-ops for every non-Swiss match.
   */
  private async maybeAdvanceSwiss(matchId: string): Promise<void> {
    try {
      await this.swissAdvance?.onMatchCompleted(matchId);
    } catch (err) {
      this.logger.warn(`Swiss advance after match ${matchId} failed: ${describe(err)}`);
    }
  }

  /**
   * After a POOL match completes, try to auto-populate the bracket. Gated by
   * populateBracket itself: a silent no-op if the pools aren't all complete or
   * any round-1 match has already started.
   */
  private async maybePopulateBracket(matchId: string): Promise<void> {
    if (!this.phases) return;
    try {
      const { data } = await this.supabase.service
        .from('matches')
        .select('phases!inner(type, tournament_id)')
        .eq('id', matchId)
        .maybeSingle();
      const phaseEmbed = (data as { phases?: unknown } | null)?.phases;
      // Many-to-one embeds are objects; normalize defensively (embed-flip gotcha).
      const phase = Array.isArray(phaseEmbed) ? phaseEmbed[0] : phaseEmbed;
      const type = (phase as { type?: string } | null)?.type;
      const tournamentId = (phase as { tournament_id?: string } | null)?.tournament_id;
      // A SWISS match can also be the one that fills a bracket: in a
      // Swiss → elimination tournament the cut is taken from the Swiss
      // standings, so the last Swiss bout is what makes the bracket seedable.
      // populateBracket's own gate makes this a no-op until the phase is
      // actually finished, so calling it on every Swiss completion is safe.
      if ((type !== 'pool' && type !== 'swiss') || !tournamentId) return;
      await this.phases.populateBracket(tournamentId, {}, 'system', { silentIfGateNotMet: true });
    } catch (err) {
      this.logger.warn(`Auto-populate after pool match ${matchId} failed: ${describe(err)}`);
    }
  }
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));
