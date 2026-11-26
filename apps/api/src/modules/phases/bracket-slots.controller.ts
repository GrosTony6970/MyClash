import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { assertCanFillBracketSlot } from '../../common/auth/bracket-slot-authz';
import { requireRequestUserId } from '../../common/auth/request-user';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { BracketAdvanceService, type SlotEntrant } from './bracket-advance.service';
import { UpdateBracketSlotDto } from './dto/phases.dto';

@ApiTags('bracket-slots')
@ApiBearerAuth()
@Controller('bracket-slots')
export class BracketSlotsController {
  constructor(
    private readonly bracketAdvance: BracketAdvanceService,
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** `admin` on the slot's own Event; each entrant of the Tournament's kind, and of it. */
  @Patch(':slotId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Override bracket slot sides (org admin+)' })
  @ApiParam({ name: 'slotId', type: 'string', format: 'uuid' })
  async overrideSlot(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateBracketSlotDto,
    @Req() req: FastifyRequest,
  ) {
    const sideA = slotSide(dto.registrationAId, dto.teamAId);
    const sideB = slotSide(dto.registrationBId, dto.teamBId);
    await assertCanFillBracketSlot(
      { supabase: this.supabase, orgs: this.organizations },
      slotId,
      [sideA, sideB],
      await requireRequestUserId(req, this.supabase),
    );
    await this.bracketAdvance.overrideSlot(slotId, sideA, sideB);
    return { slotId };
  }
}

/**
 * One side of the body: a Fighter or a team, `null` to clear it, or `undefined` for no change. The
 * DTO lets a side name one field at most.
 */
function slotSide(
  registrationId: string | null | undefined,
  teamId: string | null | undefined,
): SlotEntrant | null | undefined {
  if (registrationId !== undefined) {
    return registrationId === null ? null : { kind: 'individual', id: registrationId };
  }
  if (teamId !== undefined) return teamId === null ? null : { kind: 'team', id: teamId };
  return undefined;
}
