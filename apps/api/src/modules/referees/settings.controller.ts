/**
 * settings.controller.ts — T-902
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  enforceSchoolSeparation?: boolean;

  @IsOptional()
  @IsIn(['hard', 'soft'])
  schoolSeparationStrictness?: 'hard' | 'soft';

  @IsOptional()
  @IsBoolean()
  enforceSkillBalance?: boolean;

  // enforce_fighter_referee_no_overlap is NOT in this DTO — it cannot be changed

  @IsOptional()
  @IsBoolean()
  enforceRefereeNoBackToBack?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  refereeRestMinSlots?: number;

  @IsOptional()
  @IsBoolean()
  enforceDedicatedRefereeRest?: boolean;

  @IsOptional()
  @IsBoolean()
  workshopConflictWarning?: boolean;

  @IsOptional()
  @IsBoolean()
  ratingBasedOrdering?: boolean;

  @IsOptional()
  @IsBoolean()
  workloadBalance?: boolean;

  // Per-rule toggles for the Assignment Health rules (all default true).
  @IsOptional()
  @IsBoolean()
  enableOwnPoolRule?: boolean;

  @IsOptional()
  @IsBoolean()
  enableOfficiateVsFightRule?: boolean;

  @IsOptional()
  @IsBoolean()
  enableDoubleBookedRule?: boolean;

  @IsOptional()
  @IsBoolean()
  enableTwoRolesRule?: boolean;

  @IsOptional()
  @IsBoolean()
  enableAvailabilityRule?: boolean;

  @IsOptional()
  @IsBoolean()
  enableCapacityRule?: boolean;
}

@ApiTags('referees')
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('events/:eventId/pool-assignment-settings')
  @ApiOperation({ summary: 'Get pool assignment settings (tournament override → event default)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'tournamentId', required: false, type: 'string' })
  async get(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('tournamentId') tournamentId?: string,
  ) {
    return this.settings.getSettings(eventId, tournamentId);
  }

  @Put('events/:eventId/pool-assignment-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update pool assignment settings (organizer+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'tournamentId', required: false, type: 'string' })
  async update(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('tournamentId') tournamentId: string | undefined,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settings.upsertSettings(eventId, tournamentId ?? null, dto);
  }
}
