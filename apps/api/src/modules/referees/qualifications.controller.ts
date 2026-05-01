/**
 * qualifications.controller.ts — T-901
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { REFEREE_ROLES, type RefereeRole, QualificationsService } from './qualifications.service';

class UpsertQualificationDto {
  @IsUUID()
  personId!: string;

  @IsIn(REFEREE_ROLES)
  role!: RefereeRole;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;
}

@ApiTags('referees')
@Controller()
export class QualificationsController {
  constructor(private readonly qualifications: QualificationsService) {}

  @Get('events/:eventId/referee-qualifications')
  @ApiOperation({ summary: 'List active referee qualifications for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.qualifications.listForEvent(eventId);
  }

  @Get('events/:eventId/persons/:personId/referee-qualifications')
  @ApiOperation({ summary: 'List qualifications for a specific person' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async listForPerson(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
  ) {
    return this.qualifications.listForPerson(eventId, personId);
  }

  @Put('events/:eventId/referee-qualifications')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a referee qualification (organizer+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async upsert(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpsertQualificationDto,
  ) {
    return this.qualifications.upsert(eventId, dto.personId, dto.role, dto.rating ?? null);
  }

  @Delete('referee-qualifications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a qualification (active=false)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    await this.qualifications.deactivate(id);
  }
}
