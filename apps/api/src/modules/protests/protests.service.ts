import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { assertBoutTakes } from '../matches/bout-not-started';
import { cardSideColumns } from '../penalties/card-side';
import { matchLocked } from '../matches/match-locked';
import { isSideOfBout, namedSideOf, sideKindsOf, type BoutSideKinds } from '../matches/named-side';
import { OrganizationsService } from '../organizations/organizations.service';
import type { ScoringActor } from '../staff/staff.service';
import type { CreateProtestDto, VoidProtestDto } from './dto/protests.dto';

type Row = Record<string, unknown>;

/**
 * The bout a protest is recorded on, and its club, in one read. Only what the doors below ask:
 * a protest does not read the card rules, the round's state or the score.
 */
const BOUT_SELECT =
  'id, status, red_registration_id, blue_registration_id, red_team_id, blue_team_id, ' +
  'locked_at, current_round, ' +
  'phases!inner(tournament_id, tournaments!inner(events!inner(organization_id)))';

/** Its sides (`BoutSideKinds`): a Registration's or a team's key, null while not known. */
interface Bout extends BoutSideKinds {
  id: string;
  status: string | null;
  lockedAt: string | null;
  currentRound: number;
  tournamentId: string;
  organizationId: string;
}

type BoutEmbed = Row & {
  phases: { tournament_id: string; tournaments: { events: { organization_id: string } } };
};

/**
 * A protest ("réclamation"): one tap on the pad when a Fighter disputes the referee's call. It is
 * its own entry of the Match, beside its Exchanges and cards, and it never reaches the score: this
 * service holds no scoring service, so nothing here can recompute one. The doors are the card's
 * (`PenaltiesService.createPenalty`, `voidPenalty`) without what a card does to the score, and
 * without the card's refusal between rounds: a protest then is stamped with the round that just
 * ended (the design, call 5).
 */
@Injectable()
export class ProtestsService {
  // Every one REQUIRED (no `@Optional()`): without the guard a protest on an over Event would be
  // taken in silence, so a module that stops providing it must fail to start.
  constructor(
    private readonly supabase: SupabaseService,
    private readonly frozenResults: FrozenResultsGuard,
    private readonly orgs: OrganizationsService,
  ) {}

  /** A Match's protests, voided ones included, in the order of the pad's counter. */
  async listMatchProtests(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('match_protests')
      .select('*')
      .eq('match_id', matchId)
      .order('sequence', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createProtest(matchId: string, dto: CreateProtestDto, actor?: ScoringActor) {
    const bout = await this.boutOf(matchId);
    await this.assertScorer(bout, actor);
    const saved = await this.savedProtestOf(matchId, dto.clientUuid);
    if (saved) return saved;
    // Every refusal AFTER the replay answer, as for a card: the pad reads a refusal as "never
    // taken" and holds a protest the server already has.
    await this.frozenResults.assertExchangeCreationAllowed(matchId, actor?.userId);
    this.assertNotLocked(bout, actor);
    // The sides are not judged: protests are outside the operator's ruling of 2026-11-24, which
    // refuses a Start, a hit, a card and the colour swap of a bout waiting for a Fighter.
    await assertBoutTakes(
      this.supabase.service,
      { id: bout.id, status: bout.status, sides: 'not-judged' },
      { occurredAt: dto.occurredAt },
    );
    const side = this.sideOf(bout, dto);

    const { data, error } = await this.supabase.service
      .from('match_protests')
      .insert({
        client_uuid: dto.clientUuid,
        match_id: bout.id,
        tournament_id: bout.tournamentId,
        ...cardSideColumns(side),
        sequence: dto.sequence,
        // The round open on the server when the protest arrives, as for a card; between rounds,
        // the round that just ended.
        round_number: bout.currentRound,
        clock_time_ms: dto.clockTimeMs ?? null,
        occurred_at: dto.occurredAt,
        by_user_id: actor?.userId ?? null,
        staff_account_id: actor?.staffAccountId ?? null,
        voided: false,
      })
      .select('*')
      .single();
    if (error) {
      // Two sends of one tap at once: the second meets the first's row.
      if (error.message.includes('unique') || error.message.includes('duplicate')) {
        const raced = await this.savedProtestOf(matchId, dto.clientUuid);
        if (raced) return raced;
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  /** The undo of a protest. On an over Event, a super admin's only, as a card's void is. */
  async voidProtest(protestId: string, dto: VoidProtestDto, actor?: ScoringActor) {
    const { data: found, error: readError } = await this.supabase.service
      .from('match_protests')
      .select('*')
      .eq('id', protestId)
      .maybeSingle();
    if (readError) throw new BadRequestException(readError.message);
    if (!found) throw new NotFoundException(`Protest ${protestId} not found`);
    const protest = found as Row;
    const bout = await this.boutOf(protest['match_id'] as string);
    this.assertNotLocked(bout, actor);
    await this.assertScorer(bout, actor);
    if (protest['voided']) throw new BadRequestException('Protest is already voided');
    await this.frozenResults.assertResultMutationAllowed(bout.id, actor?.userId);

    const { data, error } = await this.supabase.service
      .from('match_protests')
      .update({ voided: true, voided_reason: dto.reason ?? null })
      .eq('id', protestId)
      .select('*')
      .single();
    // A server error, never a 400: the pad sends its undo again on a 5xx only.
    if (error) throw new Error(`Protest ${protestId} was not voided: ${error.message}`);
    return data;
  }

  /**
   * The side a protest names, judged by key and kind, as a card is. The sides are not judged as a
   * pair (above), so a side still null on the bout is refused here: no key equals null.
   */
  private sideOf(bout: Bout, dto: CreateProtestDto) {
    const side = namedSideOf(dto, 'protest');
    if (isSideOfBout(bout, side)) return side;
    throw new BadRequestException(
      side.kind === 'team'
        ? 'A protest is made by one of the two teams of the Match'
        : 'A protest is made by one of the two Fighters of the Match',
    );
  }

  private async boutOf(matchId: string): Promise<Bout> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(BOUT_SELECT)
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);
    const row = data as unknown as BoutEmbed;
    return {
      id: row['id'] as string,
      status: (row['status'] as string | null) ?? null,
      lockedAt: (row['locked_at'] as string | null) ?? null,
      ...sideKindsOf(row),
      currentRound: (row['current_round'] as number | null) ?? 1,
      tournamentId: row.phases.tournament_id,
      organizationId: row.phases.tournaments.events.organization_id,
    };
  }

  /**
   * A signed-in caller needs the club's scorekeeper role. A pad's staff session was checked on
   * its piste by the route, and a super admin correcting an over Event needs no club role.
   */
  private async assertScorer(bout: Bout, actor?: ScoringActor): Promise<void> {
    if (actor?.staffAccountId || actor?.correctsOverEvent) return;
    if (!actor?.userId) throw new UnauthorizedException('Authentication required');
    await this.orgs.assertOrgRole(bout.organizationId, actor.userId, 'scorekeeper');
  }

  private assertNotLocked(bout: Bout, actor?: ScoringActor): void {
    if (bout.lockedAt && !actor?.canOverrideLocked) throw matchLocked();
  }

  /**
   * The saved protest this pad id names, or null. A `client_uuid` is unique across every bout, so
   * a row of another bout is no replay of this one: refused, as a card's is. A failed read is an
   * error, never "not saved".
   */
  private async savedProtestOf(matchId: string, clientUuid: string): Promise<Row | null> {
    const { data, error } = await this.supabase.service
      .from('match_protests')
      .select('*')
      .eq('client_uuid', clientUuid)
      .maybeSingle();
    if (error) throw new Error(`Could not read a saved protest: ${error.message}`);
    const stored = data as Row | null;
    if (stored && stored['match_id'] !== matchId) {
      throw new BadRequestException('This id is the id of another protest');
    }
    return stored;
  }
}
