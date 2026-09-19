import {
  BadRequestException,
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
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { ImportDecision } from '@myclash/types';
import { assertCanManageEvent, assertEventMember } from '../../common/auth/event-authz';
import { assertCanManagePerson } from '../../common/auth/person-authz';
import { requireRequestUserId } from '../../common/auth/request-user';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PersonsService } from './persons.service';
import { AssignmentsService } from '../registrations/assignments.service';
import { CreatePersonDto, UpdatePersonDto } from './dto/persons.dto';

/** Read all multipart parts, returning file buffer + any JSON fields. */
async function readMultipart(
  req: FastifyRequest,
): Promise<{ buffer: Buffer | null; fields: Record<string, string> }> {
  const fields: Record<string, string> = {};
  let buffer: Buffer | null = null;

  try {
    const parts = (
      req as FastifyRequest & {
        parts: () => AsyncIterable<
          | { type: 'file'; fieldname: string; toBuffer: () => Promise<Buffer> }
          | { type: 'field'; fieldname: string; value: string }
        >;
      }
    ).parts();

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        buffer = await part.toBuffer();
      } else if (part.type === 'field') {
        fields[part.fieldname] = part.value;
      }
    }
  } catch {
    // no multipart body
  }

  return { buffer, fields };
}

/**
 * An Event's roster: emails, dates of birth, notes.
 *
 * AUTHORIZATION IS PER ROUTE. Until 2026-09-18 no route here had any: with the
 * guard in shadow mode a caller with no token read, edited and force-deleted any
 * person, and the import preview answered an uploaded name with that person's
 * email from any organisation's Event. Create and import resolved the caller only
 * to stamp `created_by_user_id`.
 *
 * Two bars, the referee board's: reading needs membership at any role, changing
 * needs `editor`. The preview is a change — the first step of an import, and it
 * names people from any organisation's roster (their email masked). A route
 * addressed by person id checks the Event the PERSON is on, never an id the caller
 * sends. Every check runs before any upload is read.
 *
 * Deleting is `editor` too, although RLS `persons_delete` asks `admin`: the
 * operator's ruling (2026-09-18), not an oversight.
 */
@ApiTags('persons')
@ApiBearerAuth()
@Controller()
export class PersonsController {
  constructor(
    private readonly persons: PersonsService,
    private readonly supabase: SupabaseService,
    private readonly assignments: AssignmentsService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** Deps in the shape `event-authz` takes. */
  private get authz() {
    return { supabase: this.supabase, orgs: this.organizations };
  }

  /**
   * GET /api/v1/events/:eventId/persons
   * List all persons for an event (any member of its organisation).
   */
  @Get('events/:eventId/persons')
  @ApiOperation({ summary: 'List persons for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Person list' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    await assertEventMember(this.authz, eventId, await requireRequestUserId(req, this.supabase));
    return this.persons.listPersons(eventId);
  }

  /**
   * POST /api/v1/events/:eventId/persons
   * Manually create a person (organizer only).
   */
  @Post('events/:eventId/persons')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a person manually' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Person created' })
  @ApiResponse({ status: 409, description: 'Email already exists in this event' })
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreatePersonDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertCanManageEvent(this.authz, eventId, userId);
    return this.persons.createPerson(eventId, dto, userId);
  }

  /**
   * POST /api/v1/events/:eventId/persons/import/preview
   * Dry-run CSV import — no DB writes.
   * Returns per-row resolution info including club matches and global person candidates.
   */
  @Post('events/:eventId/persons/import/preview')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Preview CSV import (dry run)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Preview report' })
  async previewImport(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    await assertCanManageEvent(this.authz, eventId, await requireRequestUserId(req, this.supabase));
    const { buffer } = await readMultipart(req);
    if (!buffer) {
      return {
        summary: { toCreate: 0, toLink: 0, duplicates: 0, invalid: 1 },
        newClubs: [],
        rows: [
          {
            index: 0,
            givenName: '',
            familyName: '',
            status: 'invalid',
            invalidReason: 'No file uploaded',
            defaultAction: 'create_new',
          },
        ],
      };
    }
    return this.persons.previewImport(eventId, buffer);
  }

  /**
   * POST /api/v1/events/:eventId/persons/import
   * CSV bulk import (organizer only).
   * Accepts multipart/form-data with a 'file' field (CSV) and optional 'decisions' JSON field.
   */
  @Post('events/:eventId/persons/import')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        decisions: { type: 'string', description: 'JSON array of ImportDecision' },
      },
    },
  })
  @ApiOperation({ summary: 'Import persons from CSV' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Import report' })
  async importCsv(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertCanManageEvent(this.authz, eventId, userId);
    const { buffer, fields } = await readMultipart(req);

    if (!buffer) {
      return {
        created: 0,
        updated: 0,
        duplicates: [],
        newClubsForReview: [],
        invalid: [{ row: 0, reason: 'No file uploaded', raw: '' }],
      };
    }

    let decisions: ImportDecision[] = [];
    if (fields['decisions']) {
      try {
        decisions = JSON.parse(fields['decisions']) as ImportDecision[];
      } catch {
        // invalid JSON — proceed with no decisions (all defaults)
      }
    }

    return this.persons.importCsv(eventId, buffer, userId, decisions);
  }

  /**
   * GET /api/v1/persons/:id
   * Get a single person (any member of their Event's organisation).
   */
  @Get('persons/:id')
  @ApiOperation({ summary: 'Get a person by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Person detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await assertCanManagePerson(
      this.authz,
      id,
      await requireRequestUserId(req, this.supabase),
      'read_only',
    );
    return this.persons.getPerson(id);
  }

  /**
   * PATCH /api/v1/persons/:id
   * Update a person (organizer only).
   */
  @Patch('persons/:id')
  @ApiOperation({ summary: 'Update a person' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated person' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonDto,
    @Req() req: FastifyRequest,
  ) {
    await assertCanManagePerson(this.authz, id, await requireRequestUserId(req, this.supabase));
    return this.persons.updatePerson(id, dto);
  }

  /**
   * DELETE /api/v1/persons/:id
   *
   * No query params → legacy behaviour: refuses if the person has any
   * registrations.
   *
   * `?force=true&eventId=…` → force-purge from the named event:
   * removes their registrations + scheduled matches + referee
   * assignments, then deletes the person. Refuses with 409 if any
   * match in that event has status running/paused/completed/forfeit/
   * disqualified. The named event must be the person's own: the purge probes
   * that event's bouts, then deletes the person wherever they are.
   */
  @Delete('persons/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete a person. `?force=true&eventId=…` force-purges them from that event (409 on blocking matches).',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({
    status: 400,
    description: "Has registrations — cannot delete; or eventId is not the person's event",
  })
  @ApiResponse({ status: 409, description: 'Has blocking matches; force-purge refused' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
    @Query('force') force?: string,
    @Query('eventId') eventId?: string,
  ) {
    const personEventId = await assertCanManagePerson(
      this.authz,
      id,
      await requireRequestUserId(req, this.supabase),
    );
    if (force === 'true') {
      if (!eventId) {
        throw new BadRequestException('force=true requires eventId');
      }
      if (eventId !== personEventId) {
        throw new BadRequestException(`Person ${id} is not on the roster of event ${eventId}`);
      }
      await this.assignments.forceDeletePersonInEvent(id, eventId);
      return;
    }
    await this.persons.deletePerson(id);
  }
}
