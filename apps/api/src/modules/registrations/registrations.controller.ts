import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RegistrationsService } from './registrations.service';
import { AssignmentsService } from './assignments.service';
import { CreateRegistrationDto, UpdateRegistrationStatusDto } from './dto/registrations.dto';

@ApiTags('registrations')
@ApiBearerAuth()
@Controller()
export class RegistrationsController {
  constructor(
    private readonly registrations: RegistrationsService,
    private readonly assignments: AssignmentsService,
  ) {}

  /** GET /api/v1/events/:eventId/persons/:personId/assignments */
  @Get('events/:eventId/persons/:personId/assignments')
  @ApiOperation({
    summary:
      'Where is this person assigned in this event? Used by the participant-delete modal to surface pool/bracket/match conflicts before force-delete.',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async getAssignments(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Query('tournamentId') tournamentId?: string,
  ) {
    return this.assignments.getEventAssignments(eventId, personId, tournamentId);
  }

  /** GET /api/v1/tournaments/:tournamentId/registrations */
  @Get('tournaments/:tournamentId/registrations')
  @ApiOperation({ summary: 'List registrations for a tournament' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async list(@Param('tournamentId', ParseUUIDPipe) tournamentId: string) {
    return this.registrations.list(tournamentId);
  }

  /** GET /api/v1/events/:eventId/registrations */
  @Get('events/:eventId/registrations')
  @ApiOperation({ summary: 'List every registration across all tournaments under an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listForEvent(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.registrations.listForEvent(eventId);
  }

  /** POST /api/v1/tournaments/:tournamentId/registrations */
  @Post('tournaments/:tournamentId/registrations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a person to a tournament (bib auto-assigned if omitted)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async create(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: CreateRegistrationDto,
  ) {
    return this.registrations.create(tournamentId, dto);
  }

  /**
   * POST /api/v1/tournaments/:tournamentId/waitlist
   *
   * Slice 2: explicit waitlist add. Operator calls this after the regular
   * create returned 409 reason='tournament_full'. Inserts at the next
   * waitlist_position; returns 409 reason='waitlist_full' when capped.
   */
  @Post('tournaments/:tournamentId/waitlist')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a person to the tournament waitlist' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async addToWaitlist(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: CreateRegistrationDto,
  ) {
    return this.registrations.addToWaitlist(tournamentId, dto);
  }

  // (`POST tournaments/:tournamentId/registrations/import` was removed —
  // superseded by the persons importer, `events/:eventId/persons/import`,
  // which is what the CSV-import UI calls.)

  /**
   * PATCH /api/v1/registrations/:id/status
   * Enforces status transitions: registered → checked_in → done.
   */
  @Patch('registrations/:id/status')
  @ApiOperation({ summary: 'Update registration status (enforces valid transitions)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRegistrationStatusDto,
  ) {
    return this.registrations.updateStatus(id, dto.status);
  }

  /**
   * POST /api/v1/registrations/:id/promote
   *
   * Slice 3b: promote any waitlist entry directly to registered. Capacity
   * stays enforced — pass ?force=true to override.
   */
  @Post('registrations/:id/promote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Promote a waitlist entry to registered (?force=true to override cap)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async promote(@Param('id', ParseUUIDPipe) id: string, @Query('force') forceParam?: string) {
    const force = forceParam === 'true';
    await this.registrations.promoteFromWaitlist(id, force);
    return { promoted: true };
  }

  /**
   * PATCH /api/v1/tournaments/:tournamentId/waitlist/reorder
   *
   * Slice 3c: rewrite the waitlist order in one bulk call.
   */
  @Patch('tournaments/:tournamentId/waitlist/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bulk reorder the tournament waitlist' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async reorderWaitlist(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: { orderedRegistrationIds: string[] },
  ) {
    await this.registrations.reorderWaitlist(tournamentId, dto.orderedRegistrationIds);
  }

  /** DELETE /api/v1/registrations/:id */
  @Delete('registrations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a registration' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.registrations.delete(id);
  }

  /**
   * POST /api/v1/registrations/:id/force-delete
   *
   * Force-delete a single registration after the FE has confirmed the
   * usage modal. Refuses with 409 if any blocking match exists for the
   * person in this tournament (running/paused/completed/forfeit/
   * disqualified). Otherwise deletes the unplayed matches that
   * reference this registration, then deletes the registration.
   */
  @Post('registrations/:id/force-delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Force-delete a registration and its unplayed matches; 409 if any blocking match exists',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async forceDelete(@Param('id', ParseUUIDPipe) id: string) {
    await this.assignments.forceDeleteRegistration(id);
  }
}
