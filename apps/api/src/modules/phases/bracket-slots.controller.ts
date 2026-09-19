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
import { BracketAdvanceService } from './bracket-advance.service';
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

  /** `admin` on the slot's own Event; each fighter entered in the slot's tournament. */
  @Patch(':slotId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Override bracket slot registrations (org admin+)' })
  @ApiParam({ name: 'slotId', type: 'string', format: 'uuid' })
  async overrideSlot(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateBracketSlotDto,
    @Req() req: FastifyRequest,
  ) {
    await assertCanFillBracketSlot(
      { supabase: this.supabase, orgs: this.organizations },
      slotId,
      [dto.registrationAId, dto.registrationBId],
      await requireRequestUserId(req, this.supabase),
    );
    await this.bracketAdvance.overrideSlot(slotId, dto.registrationAId, dto.registrationBId);
    return { slotId };
  }
}
