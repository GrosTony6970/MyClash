import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
// Value imports, not `import type`: Nest DI metadata.
import { SwissPairingService } from './swiss-pairing.service';
import { activeEntrants, validateSwissRound, type SwissRoundValidation } from './swiss-snapshot';
import {
  loadEditableRoundData,
  type EditableRound,
  type MatchRow,
  type OverrideWarning,
  type Position,
} from './swiss-override-context';

/**
 * Manual pairing override (decision 14): swap by default, set-sides as the
 * escape hatch.
 *
 * Both refuse outright when the phase is finalised, the round has left
 * `pending`, or an affected bout has already started — past that point a
 * pairing change is not an adjustment, it is a rewrite of a result. Both WARN
 * (409, proceed on `confirm`) rather than refuse on the three things an
 * organiser might legitimately want anyway: creating a rematch, giving someone
 * a second bye, or pairing two fighters from the same club.
 *
 * Neither touches `lice_id` or `scheduled_at`, so the schedule is untouched,
 * and neither needs referee revalidation — the fighter-as-own-referee guard is
 * round-scoped, so moving a fighter between pistes inside one round cannot
 * create a conflict it would not already have had.
 */
@Injectable()
export class SwissOverrideService {
  private readonly logger = new Logger(SwissOverrideService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly pairing: SwissPairingService,
  ) {}

  /**
   * Exchange two fighters wherever they sit in the round.
   *
   * Invariant-preserving by construction — after the swap everybody still
   * appears exactly once and there is still exactly one bye. Either fighter may
   * be the bye holder, which is how "give the bye to someone else" is expressed
   * rather than being a separate operation.
   */
  async swapPairing(
    roundId: string,
    aRegistrationId: string,
    bRegistrationId: string,
    actorUserId: string | null,
    confirm = false,
  ): Promise<{ validation: SwissRoundValidation }> {
    if (aRegistrationId === bRegistrationId) {
      throw new BadRequestException('Cannot swap a fighter with themselves');
    }
    const round = await this.loadEditableRound(roundId);

    const positions = [
      this.locate(round, aRegistrationId),
      this.locate(round, bRegistrationId),
    ] as const;
    for (const [i, position] of positions.entries()) {
      if (!position) {
        const missing = i === 0 ? aRegistrationId : bRegistrationId;
        throw new BadRequestException(`Fighter ${missing} is not in round ${round.roundNumber}`);
      }
    }
    const [a, b] = positions as [Position, Position];

    const warnings = this.swapWarnings(round, a, b);
    if (warnings.length > 0 && !confirm) {
      throw new ConflictException({ message: 'Swap needs confirmation', warnings });
    }

    // Apply to a copy first so the write set is computed from a consistent
    // picture — a swap can touch one match (both fighters in it), two matches,
    // or one match plus the bye.
    await this.applySwap(round, a, b);
    await this.recordAdjustment(round, actorUserId, {
      kind: 'swap',
      aRegistrationId,
      bRegistrationId,
      warnings,
    });

    return { validation: await this.validate(round.phaseId, roundId) };
  }

  /**
   * Write both sides of one match directly.
   *
   * The escape hatch, and the reason `validateSwissRound` exists: this CAN
   * leave a fighter in two bouts or in none. The result is reported on the
   * round card and blocks the next round from being committed, rather than
   * being silently carried forward into every subsequent pairing.
   */
  async setMatchSides(
    matchId: string,
    redRegistrationId: string | null,
    blueRegistrationId: string | null,
    actorUserId: string | null,
    confirm = false,
  ): Promise<{ validation: SwissRoundValidation }> {
    if (redRegistrationId !== null && redRegistrationId === blueRegistrationId) {
      throw new BadRequestException('A fighter cannot be on both sides of a match');
    }

    const { data: matchRow } = await this.supabase.service
      .from('matches')
      .select('id, status, swiss_round_id, red_registration_id, blue_registration_id')
      .eq('id', matchId)
      .maybeSingle();
    const match = matchRow as MatchRow | null;
    if (!match?.swiss_round_id) throw new NotFoundException(`Swiss match ${matchId} not found`);
    if (match.status !== 'scheduled') {
      throw new ConflictException(`Match ${matchId} has already started`);
    }

    const round = await this.loadEditableRound(match.swiss_round_id);
    const warnings = this.sidesWarnings(round, redRegistrationId, blueRegistrationId);
    if (warnings.length > 0 && !confirm) {
      throw new ConflictException({ message: 'Side change needs confirmation', warnings });
    }

    await this.writeMatchSides(matchId, redRegistrationId, blueRegistrationId);
    await this.recordAdjustment(round, actorUserId, {
      kind: 'set-sides',
      matchId,
      from: {
        red: match.red_registration_id,
        blue: match.blue_registration_id,
      },
      to: { red: redRegistrationId, blue: blueRegistrationId },
      warnings,
    });

    return { validation: await this.validate(round.phaseId, round.id) };
  }

  /** Current validity of a round, for the round card and the commit gate. */
  async validate(phaseId: string, roundId: string): Promise<SwissRoundValidation> {
    const round = await this.loadRound(roundId);
    const entrants = await this.pairing.loadEntrants(phaseId);
    const field = activeEntrants(entrants, round.roundNumber).map((e) => e.registrationId);
    return validateSwissRound(
      field,
      round.matches.map((m) => ({
        redRegistrationId: m.red_registration_id,
        blueRegistrationId: m.blue_registration_id,
      })),
      round.byeRegistrationId,
    );
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private locate(round: EditableRound, registrationId: string): Position | null {
    if (round.byeRegistrationId === registrationId) return { kind: 'bye' };
    for (const match of round.matches) {
      if (match.red_registration_id === registrationId)
        return { kind: 'match', match, side: 'red' };
      if (match.blue_registration_id === registrationId) {
        return { kind: 'match', match, side: 'blue' };
      }
    }
    return null;
  }

  private async applySwap(round: EditableRound, a: Position, b: Position): Promise<void> {
    const aId = this.occupant(round, a);
    const bId = this.occupant(round, b);

    if (a.kind === 'match' && b.kind === 'match' && a.match.id === b.match.id) {
      // Both in the same bout: that is a side change, not a re-pairing.
      await this.writeMatchSides(a.match.id, bId, aId);
      return;
    }
    if (a.kind === 'match') await this.writeSide(a.match.id, a.side, bId);
    if (b.kind === 'match') await this.writeSide(b.match.id, b.side, aId);
    if (a.kind === 'bye') await this.writeBye(round.id, bId);
    if (b.kind === 'bye') await this.writeBye(round.id, aId);
  }

  private occupant(round: EditableRound, position: Position): string | null {
    if (position.kind === 'bye') return round.byeRegistrationId;
    return position.side === 'red'
      ? position.match.red_registration_id
      : position.match.blue_registration_id;
  }

  /**
   * Every write is fail-loud. A production trace showed manual-assign PATCHes
   * returning 200 with nothing persisted because the Supabase result was never
   * inspected — `select().maybeSingle()` returning null means the WHERE matched
   * no row, which is a 404, not a success.
   */
  private async writeSide(
    matchId: string,
    side: 'red' | 'blue',
    registrationId: string | null,
  ): Promise<void> {
    const column = side === 'red' ? 'red_registration_id' : 'blue_registration_id';
    const { data, error } = await this.supabase.service
      .from('matches')
      .update({ [column]: registrationId })
      .eq('id', matchId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);
  }

  private async writeMatchSides(
    matchId: string,
    red: string | null,
    blue: string | null,
  ): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .update({ red_registration_id: red, blue_registration_id: blue })
      .eq('id', matchId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);
  }

  private async writeBye(roundId: string, registrationId: string | null): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('swiss_rounds')
      .update({ bye_registration_id: registrationId })
      .eq('id', roundId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Swiss round ${roundId} not found`);
  }

  private swapWarnings(round: EditableRound, a: Position, b: Position): OverrideWarning[] {
    const aId = this.occupant(round, a);
    const bId = this.occupant(round, b);
    const warnings: OverrideWarning[] = [];

    // After the swap each fighter inherits the OTHER's opponent.
    const opponentAfter = (position: Position, moving: string | null): string | null => {
      if (position.kind === 'bye') return null;
      const other =
        position.side === 'red'
          ? position.match.blue_registration_id
          : position.match.red_registration_id;
      return other === moving ? null : other;
    };

    for (const [fighter, position, partner] of [
      [aId, b, bId],
      [bId, a, aId],
    ] as const) {
      const opponent = opponentAfter(position, partner);
      if (fighter && opponent && round.priorOpponents.get(fighter)?.has(opponent)) {
        warnings.push({ code: 'creates-rematch', registrationIds: [fighter, opponent] });
      }
      if (fighter && opponent && this.sameClub(round, fighter, opponent)) {
        warnings.push({ code: 'same-club', registrationIds: [fighter, opponent] });
      }
    }
    for (const [fighter, position] of [
      [aId, b],
      [bId, a],
    ] as const) {
      if (fighter && position.kind === 'bye' && round.priorByes.has(fighter)) {
        warnings.push({ code: 'repeat-bye', registrationIds: [fighter] });
      }
    }
    return warnings;
  }

  private sidesWarnings(
    round: EditableRound,
    red: string | null,
    blue: string | null,
  ): OverrideWarning[] {
    const warnings: OverrideWarning[] = [];
    if (!red || !blue) return warnings;
    if (round.priorOpponents.get(red)?.has(blue)) {
      warnings.push({ code: 'creates-rematch', registrationIds: [red, blue] });
    }
    if (this.sameClub(round, red, blue)) {
      warnings.push({ code: 'same-club', registrationIds: [red, blue] });
    }
    return warnings;
  }

  private sameClub(round: EditableRound, a: string, b: string): boolean {
    const clubA = round.clubByRegistration.get(a);
    const clubB = round.clubByRegistration.get(b);
    return Boolean(clubA && clubB && clubA === clubB);
  }

  /**
   * Recorded twice on purpose: `insertAuditLog` for governance (the one writer,
   * actor a real UUID and never a sentinel), and
   * `swiss_rounds.pairing_meta_json.manualAdjustments` so BOTH the admin round
   * card and the public round view can badge the round as manually adjusted
   * (decision 16) without joining the audit table.
   */
  private async recordAdjustment(
    round: EditableRound,
    actorUserId: string | null,
    entry: Record<string, unknown>,
  ): Promise<void> {
    const stamped = { ...entry, at: new Date().toISOString(), byUserId: actorUserId };

    const meta = { ...(round.pairingMeta ?? {}) };
    const adjustments = Array.isArray(meta['manualAdjustments'])
      ? (meta['manualAdjustments'] as unknown[])
      : [];
    meta['manualAdjustments'] = [...adjustments, stamped];

    const { error } = await this.supabase.service
      .from('swiss_rounds')
      .update({ pairing_meta_json: meta })
      .eq('id', round.id);
    if (error) throw new BadRequestException(error.message);

    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: `swiss.pairing_${entry['kind'] === 'swap' ? 'swap' : 'set_sides'}`,
      entityType: 'swiss_round',
      entityId: round.id,
      payload: stamped,
    });
    this.logger.log(`swiss round ${round.id} manually adjusted: ${JSON.stringify(entry)}`);
  }

  private async loadEditableRound(roundId: string): Promise<EditableRound> {
    const round = await this.loadRound(roundId);
    if (round.status !== 'pending') {
      throw new ConflictException(
        `Round ${round.roundNumber} has started; pairings can no longer be changed`,
      );
    }
    if (round.matches.some((m) => m.status !== 'scheduled')) {
      throw new ConflictException(`Round ${round.roundNumber} has a bout already under way`);
    }
    const context = await this.pairing.loadContext(round.phaseId);
    if (context?.config.finalized) {
      throw new ConflictException('This Swiss phase is finalised; resume it before editing');
    }
    return round;
  }

  private loadRound(roundId: string): Promise<EditableRound> {
    return loadEditableRoundData(this.supabase, this.pairing, roundId);
  }
}
