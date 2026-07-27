import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { matchRulesetForPhase } from './match-ruleset';
import {
  buildSelfRef,
  grandFinalEndsBracket,
  resolveLoser,
  type PhaseConfig,
} from './bracket-refs';

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

      if (grandFinalEndsBracket(phase.type as string, config, slot, match)) return;

      const selfRef = buildSelfRef(slot.round, slot.position, phase.type as string, config);
      const loserRegId = resolveLoser({
        winner_registration_id: match.winner_registration_id,
        red_registration_id: match.red_registration_id,
        blue_registration_id: match.blue_registration_id,
      });

      await this.advanceFromSlot(slot.phase_id, selfRef, match.winner_registration_id, loserRegId);
    } catch (err) {
      this.logger.error(`Bracket advance failed for match ${matchId}: ${String(err)}`);
    }
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

    // Re-check if slot is now fully resolved
    const slot = await this.loadSlot(slotId);
    if (!slot) return;

    if (registrationAId === null || registrationBId === null) {
      // Cancellation — delete downstream match if not started
      await this.deleteUnstartedMatch(slotId);
      return;
    }

    await this.createMatchIfReady(slot);
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

      // Determine which side this slot is filling. Each branch goes
      // through writeSlotSide so a failed write throws instead of
      // silently corrupting the in-memory `updatedSlot` we hand to
      // createMatchIfReady below.
      if (ds.source_a_ref === winnerRef && ds.registration_a_id === null) {
        updatedA = winnerRegId;
        await this.writeSlotSide(ds.id, 'a', winnerRegId);
      } else if (ds.source_a_ref === loserRef && loserRegId && ds.registration_a_id === null) {
        updatedA = loserRegId;
        await this.writeSlotSide(ds.id, 'a', loserRegId);
      } else if (ds.source_b_ref === winnerRef && ds.registration_b_id === null) {
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

  /**
   * Invoked from overrideSlot when an operator un-sets a bracket
   * slot's side. With placeholder match rows pre-created at bracket
   * generation, the row may carry an operator-placed schedule
   * (lice_id + scheduled_at) — voiding it would hide the chip from
   * the schedule grid and lose that placement. Instead, clear the
   * row's registrations and reset status to 'scheduled' so the row
   * stays visible and a future re-advancement can re-populate
   * registrations in place via writeSlotSide's matches UPDATE.
   *
   * Scoped to non-voided rows (replay/regen-flow can leave voided
   * history alongside the live row) AND to rows whose match has not
   * yet started — never touch an in-flight match.
   */
  private async deleteUnstartedMatch(slotId: string): Promise<void> {
    await this.supabase.service
      .from('matches')
      .update({
        red_registration_id: null,
        blue_registration_id: null,
        status: 'scheduled',
      })
      .eq('bracket_slot_id', slotId)
      .not('status', 'eq', 'voided')
      .is('started_at', null);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async loadMatch(matchId: string) {
    const { data } = await this.supabase.service
      .from('matches')
      .select(
        'id, bracket_slot_id, winner_registration_id, red_registration_id, blue_registration_id',
      )
      .eq('id', matchId)
      .maybeSingle();
    return data as {
      id: string;
      bracket_slot_id: string | null;
      winner_registration_id: string | null;
      red_registration_id: string;
      blue_registration_id: string;
    } | null;
  }

  private async loadSlot(slotId: string) {
    const { data } = await this.supabase.service
      .from('bracket_slots')
      .select('id, round, position, phase_id, source_b_type, registration_a_id, registration_b_id')
      .eq('id', slotId)
      .maybeSingle();
    return data as {
      id: string;
      round: number;
      position: number;
      phase_id: string;
      source_b_type: string;
      registration_a_id: string | null;
      registration_b_id: string | null;
    } | null;
  }

  private async loadPhase(phaseId: string) {
    const { data } = await this.supabase.service
      .from('phases')
      .select('id, type, config_json')
      .eq('id', phaseId)
      .maybeSingle();
    return data as { id: string; type: unknown; config_json: unknown } | null;
  }
}
