import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { matchRulesetForPhase } from './match-ruleset';
import {
  buildSelfRef,
  grandFinalEndsBracket,
  resolveLoser,
  type PhaseConfig,
} from './bracket-refs';
import {
  clearDownstreamOf,
  findDownstreamMatchIds,
  loadMatch,
  loadPhase,
  loadSlot,
  retractGrandFinalReset,
} from './bracket-downstream';
import { assertSlotMatchRewritable, syncMatchToSlot } from './bracket-match-sync';

@Injectable()
export class BracketAdvanceService {
  private readonly logger = new Logger(BracketAdvanceService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ── Public entry points ───────────────────────────────────────────────────

  async onMatchCompleted(matchId: string): Promise<void> {
    try {
      const match = await this.loadMatch(matchId);
      if (!match?.bracket_slot_id || !match.winner_registration_id) return;

      const slot = await this.loadSlot(match.bracket_slot_id);
      if (!slot) return;

      const phase = await this.loadPhase(slot.phase_id);
      if (!phase) return;

      const config = (phase.config_json ?? {}) as PhaseConfig;
      if (config.autoAdvance === false) return;

      // Not merely skipped — UN-MADE. The reset slot is the one slot with no
      // generation-time placeholder, so when the losers-bracket entrant wins it
      // the match row is created on demand; changing that result to a
      // winners-bracket win used to leave the row behind as a bout that can
      // never legitimately be played. Failures are swallowed by the catch
      // below, so the worst case is the phantom surviving with an error logged
      // — never worse than the bare return was.
      if (grandFinalEndsBracket(phase.type as string, config, slot, match)) {
        await retractGrandFinalReset(this.supabase.service, matchId);
        return;
      }

      const selfRef = buildSelfRef(slot.round, slot.position, phase.type as string, config);
      // The SLOT is authoritative for who is in a bracket match — populate and
      // advancement both write it before the matches row, so the row can lag.
      // Reading the pairing from the match alone is what froze play-in double
      // elims: the seeded side was null there, so the loser resolved to null
      // and nothing was ever fed into the losers bracket.
      const loserRegId = resolveLoser({
        winner_registration_id: match.winner_registration_id,
        red_registration_id: slot.registration_a_id ?? match.red_registration_id,
        blue_registration_id: slot.registration_b_id ?? match.blue_registration_id,
      });

      await this.advanceFromSlot(slot.phase_id, selfRef, match.winner_registration_id, loserRegId);
    } catch (err) {
      this.logger.error(`Bracket advance failed for match ${matchId}: ${String(err)}`);
    }
  }

  /** The matches this one feeds. See bracket-downstream.ts for the ref algebra. */
  async findDownstreamMatchIds(matchId: string): Promise<string[]> {
    return findDownstreamMatchIds(this.supabase.service, matchId);
  }

  /** Un-resolve the sides this match feeds, so advancement can fill them again. */
  async clearDownstreamOf(matchId: string): Promise<void> {
    return clearDownstreamOf(this.supabase.service, matchId);
  }

  /** Called after seeds are populated at bracket generation time — advances bye slots immediately. */
  async advanceByeSlots(phaseId: string): Promise<void> {
    try {
      const { data: byeSlots } = await this.supabase.service
        .from('bracket_slots')
        .select('id, round, position, source_b_type, registration_a_id')
        .eq('phase_id', phaseId)
        .eq('source_b_type', 'bye')
        .not('registration_a_id', 'is', null);

      if (!byeSlots?.length) return;

      const phase = await this.loadPhase(phaseId);
      if (!phase) return;

      const config = (phase.config_json ?? {}) as PhaseConfig;

      for (const slot of byeSlots) {
        const s = slot as { round: number; position: number; registration_a_id: string };
        const selfRef = buildSelfRef(s.round, s.position, phase.type as string, config);
        await this.advanceFromSlot(phaseId, selfRef, s.registration_a_id, null);
      }
    } catch (err) {
      this.logger.error(`Bye advancement failed for phase ${phaseId}: ${String(err)}`);
    }
  }

  // ── Override slot (called from bracket-slots.controller) ─────────────────

  async overrideSlot(
    slotId: string,
    registrationAId: string | null | undefined,
    registrationBId: string | null | undefined,
  ): Promise<void> {
    this.logger.log(
      `overrideSlot slot=${slotId} a=${registrationAId ?? 'unchanged'} b=${registrationBId ?? 'unchanged'}`,
    );

    const updates: Record<string, unknown> = {};
    if (registrationAId !== undefined) updates['registration_a_id'] = registrationAId;
    if (registrationBId !== undefined) updates['registration_b_id'] = registrationBId;

    if (Object.keys(updates).length === 0) return;

    // Refuse BEFORE writing the slot, not after. The sync below throws on a
    // bout already under way, and doing that after the slot write would leave
    // the slot changed and the match not — a split-brain in the opposite
    // direction to the one this method exists to fix. No transaction is
    // available through supabase-js, so ordering is the whole guarantee.
    await assertSlotMatchRewritable(this.supabase.service, slotId);

    // Fail loud: production trace showed manual-assign PATCHes returning
    // 200 with no row actually persisted because the supabase result was
    // not inspected. `select().maybeSingle()` returns the updated row (1)
    // or null (0) — null + null-error means the WHERE clause matched
    // nothing, supabase error means the DB rejected the write (e.g. FK
    // violation on a stale registration id).
    const { data: persisted, error: updateError } = await this.supabase.service
      .from('bracket_slots')
      .update(updates)
      .eq('id', slotId)
      .select('id, registration_a_id, registration_b_id')
      .maybeSingle();
    if (updateError) throw new BadRequestException(updateError.message);
    if (!persisted) throw new NotFoundException(`Bracket slot ${slotId} not found`);
    this.logger.log(
      `overrideSlot persisted slot=${slotId} a=${(persisted as { registration_a_id: string | null }).registration_a_id ?? 'null'} b=${(persisted as { registration_b_id: string | null }).registration_b_id ?? 'null'}`,
    );

    const slot = await this.loadSlot(slotId);
    if (!slot) return;

    // One call, both directions. This used to fork: `null` on EITHER side ran
    // deleteUnstartedMatch and returned, so a single PATCH that swapped one
    // fighter for another (clear A, set B) blanked the row and dropped B on the
    // floor; anything else ran createMatchIfReady, which returns early when a
    // row already exists, so putting a fighter back into a cleared slot left
    // the match showing nobody. Neither branch could reach the only code that
    // writes registrations into an existing matches row.
    await syncMatchToSlot(this.supabase.service, slot, { onStarted: 'throw' });
  }

  // ── Core advance logic ────────────────────────────────────────────────────

  private async advanceFromSlot(
    phaseId: string,
    selfRef: string,
    winnerRegId: string,
    loserRegId: string | null,
  ): Promise<void> {
    const winnerRef = `winner of ${selfRef}`;
    const loserRef = `loser of ${selfRef}`;

    const { data: downstream } = await this.supabase.service
      .from('bracket_slots')
      .select(
        'id, round, position, phase_id, source_a_type, source_a_ref, source_b_type, source_b_ref, registration_a_id, registration_b_id',
      )
      .eq('phase_id', phaseId)
      .or(
        `source_a_ref.eq.${winnerRef},source_b_ref.eq.${winnerRef},source_a_ref.eq.${loserRef},source_b_ref.eq.${loserRef}`,
      );

    if (!downstream?.length) return;

    for (const rawSlot of downstream) {
      const ds = rawSlot as {
        id: string;
        round: number;
        position: number;
        phase_id: string;
        source_a_type: string;
        source_a_ref: string;
        source_b_type: string;
        source_b_ref: string;
        registration_a_id: string | null;
        registration_b_id: string | null;
      };

      let updatedA = ds.registration_a_id;
      let updatedB = ds.registration_b_id;

      // Sides A and B are resolved INDEPENDENTLY. They used to share one
      // if/else-if chain, which wrote at most one side per call — fine for
      // every slot whose two sides come from two different upstream matches,
      // which is all of them but one. The grand-final reset takes BOTH sides
      // from the grand final (`loser of GF` and `winner of GF`), so the chain
      // filled side A, exited, and left side B unresolved forever: the reset
      // could never be played, and with it sitting at the bracket's highest
      // round the tournament stayed permanently undecided.
      //
      // Within a side the two branches stay mutually exclusive — a ref cannot
      // be both the winner and the loser of the same match. Each write goes
      // through writeSlotSide so a failed write throws rather than silently
      // corrupting the in-memory `updatedSlot` handed to createMatchIfReady.
      if (ds.source_a_ref === winnerRef && ds.registration_a_id === null) {
        updatedA = winnerRegId;
        await this.writeSlotSide(ds.id, 'a', winnerRegId);
      } else if (ds.source_a_ref === loserRef && loserRegId && ds.registration_a_id === null) {
        updatedA = loserRegId;
        await this.writeSlotSide(ds.id, 'a', loserRegId);
      }

      if (ds.source_b_ref === winnerRef && ds.registration_b_id === null) {
        updatedB = winnerRegId;
        await this.writeSlotSide(ds.id, 'b', winnerRegId);
      } else if (ds.source_b_ref === loserRef && loserRegId && ds.registration_b_id === null) {
        updatedB = loserRegId;
        await this.writeSlotSide(ds.id, 'b', loserRegId);
      }

      // Re-load with updated values for match creation check
      const updatedSlot = {
        ...ds,
        registration_a_id: updatedA,
        registration_b_id: updatedB,
      };

      await this.createMatchIfReady(updatedSlot);
    }
  }

  private async createMatchIfReady(slot: {
    id: string;
    phase_id: string;
    /** 1-indexed slot position within the round. Stamped as
     *  match_number_label so the scoreboard renders the same canonical
     *  code (LSW-R16-M1) the bracket view shows. */
    position?: number;
    source_b_type: string;
    registration_a_id: string | null;
    registration_b_id: string | null;
  }): Promise<void> {
    const sideAReady = !!slot.registration_a_id;
    const sideBReady = !!slot.registration_b_id || slot.source_b_type === 'bye';

    if (!sideAReady || !sideBReady) return;
    if (slot.source_b_type === 'bye') return; // bye slots never get a match

    // Idempotency: check no active match exists for this slot
    const { data: existing } = await this.supabase.service
      .from('matches')
      .select('id, status')
      .eq('bracket_slot_id', slot.id)
      .not('status', 'eq', 'voided')
      .maybeSingle();

    if (existing) return;

    await this.supabase.service.from('matches').insert({
      phase_id: slot.phase_id,
      bracket_slot_id: slot.id,
      red_registration_id: slot.registration_a_id,
      blue_registration_id: slot.registration_b_id,
      status: 'scheduled',
      red_score: 0,
      blue_score: 0,
      // Tournament's ruleset, not a hardcoded TF_v1 — scoring reads the match row.
      ...(await matchRulesetForPhase(this.supabase.service, slot.phase_id)),
      match_number_label: typeof slot.position === 'number' ? String(slot.position) : null,
    });

    this.logger.log(`Created match for bracket slot ${slot.id}`);
  }

  /**
   * Persist a winner/loser propagation onto one side of a downstream
   * slot, asserting the row was actually modified. The pre-fix code
   * issued `update(...).eq(...)` with no `.select()` and no `error`
   * check, so an FK violation or a stale slot id (e.g. the downstream
   * row was deleted between the SELECT in advanceFromSlot and this
   * write) silently no-op'd and corrupted the in-memory state we
   * then passed to createMatchIfReady.
   */
  private async writeSlotSide(
    slotId: string,
    side: 'a' | 'b',
    registrationId: string,
  ): Promise<void> {
    const column = side === 'a' ? 'registration_a_id' : 'registration_b_id';
    const { data, error } = await this.supabase.service
      .from('bracket_slots')
      .update({ [column]: registrationId })
      .eq('id', slotId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Bracket slot ${slotId} not found`);

    // Push the resolved registration into the placeholder matches row
    // pre-created at bracket generation (phases.service.ts
    // createInitialBracketMatches). The matches row exists from the
    // moment the bracket was generated — UPDATEing it here preserves
    // any schedule (lice_id + scheduled_at) the operator has already
    // attached to the chip. The legacy INSERT path in
    // createMatchIfReady stays as a defensive fallback for any slot
    // missed at generation time. Skip voided rows: replay/regen-flow
    // can leave a voided historical row alongside the live one.
    const matchColumn = side === 'a' ? 'red_registration_id' : 'blue_registration_id';
    await this.supabase.service
      .from('matches')
      .update({ [matchColumn]: registrationId })
      .eq('bracket_slot_id', slotId)
      .not('status', 'eq', 'voided');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private loadMatch(matchId: string) {
    return loadMatch(this.supabase.service, matchId);
  }

  private loadSlot(slotId: string) {
    return loadSlot(this.supabase.service, slotId);
  }

  private loadPhase(phaseId: string) {
    return loadPhase(this.supabase.service, phaseId);
  }
}
