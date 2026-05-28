import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { BracketAdvanceService } from './bracket-advance.service';
import { UpdateBracketSlotDto } from './dto/phases.dto';

@ApiTags('bracket-slots')
@ApiBearerAuth()
@Controller('bracket-slots')
export class BracketSlotsController {
  constructor(private readonly bracketAdvance: BracketAdvanceService) {}

  @Patch(':slotId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Override bracket slot registrations (organiser only)' })
  @ApiParam({ name: 'slotId', type: 'string', format: 'uuid' })
  async overrideSlot(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateBracketSlotDto,
  ) {
    await this.bracketAdvance.overrideSlot(slotId, dto.registrationAId, dto.registrationBId);
    return { slotId };
  }
}
