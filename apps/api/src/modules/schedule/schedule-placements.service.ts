import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
// Value imports, not `import type` — `import type` erases the DI metadata and
// the dependency arrives undefined at runtime.
import { OrganizationsService } from '../organizations/organizations.service';
import { MatchPlacementService } from '../matches/match-placement.service';
import { assertCanManageEvent } from '../../common/auth/event-authz';
import { assertMatchesBelongToEvent } from '../events/in-event';
import type { SchedulePlacementsDto } from './dto/schedule-placements.dto';

/**
 * The schedule board's save: every gesture that moves bouts is ONE batch.
 *
 * The board used to send one `PATCH /matches/:id/schedule` per bout, all at
 * once. The server judged each against bouts that had not moved yet, so a Pool
 * dragged fifteen minutes later put its first bouts where its last ones still
 * sat: three PATCHes in six were refused, the rest landed, and the Pool was split
 * in two.
 * Which bouts lost depended on which request arrived first.
 *
 * The placement owner already judges a batch as a whole — the batch's own rows
 * are left out of what holds the pistes, then checked against each other — so
 * this door only decides who may place and which Event the bouts are in, then
 * hands it the batch as the board sent it. The board lays the bouts out itself;
 * unlike the run window's save, there is nothing here to lay.
 *
 * Not transactional, like every placement: the check is all-or-nothing, the
 * writes are per row, and a partial write says so.
 */
@Injectable()
export class SchedulePlacementsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly placement: MatchPlacementService,
  ) {}

  async savePlacements(
    eventId: string,
    dto: SchedulePlacementsDto,
    userId: string,
  ): Promise<{ placed: number }> {
    // A lapsed session, refused as the single PATCH refused it: 401, which the
    // board words as "sign in again". The org check would say "not a member".
    if (userId === ANONYMOUS_USER_ID) throw new UnauthorizedException('Organizer session required');
    await assertCanManageEvent({ supabase: this.supabase, orgs: this.orgs }, eventId, userId);
    await assertMatchesBelongToEvent(
      this.supabase.service,
      eventId,
      dto.placements.map((row) => row.matchId),
    );
    await this.placement.placeMatches(eventId, dto.placements);
    return { placed: dto.placements.length };
  }
}
