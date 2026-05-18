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
  Req,
  UnauthorizedException,
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
import { SupabaseService } from '../supabase/supabase.service';
import { PersonsService } from './persons.service';
import { CreatePersonDto, UpdatePersonDto } from './dto/persons.dto';

/** Resolve the authenticated user UUID from the Supabase access token. */
async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user?.id) throw new UnauthorizedException('Invalid or expired session');
  return user.id;
}

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

@ApiTags('persons')
@ApiBearerAuth()
@Controller()
export class PersonsController {
  constructor(
    private readonly persons: PersonsService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * GET /api/v1/events/:eventId/persons
   * List all persons for an event (organizer only).
   */
  @Get('events/:eventId/persons')
  @ApiOperation({ summary: 'List persons for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Person list' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string) {
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
    return this.persons.createPerson(eventId, dto, await getUserId(req, this.supabase));
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

    return this.persons.importCsv(eventId, buffer, await getUserId(req, this.supabase), decisions);
  }

  /**
   * GET /api/v1/persons/:id
   * Get a single person (organizer or self).
   */
  @Get('persons/:id')
  @ApiOperation({ summary: 'Get a person by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Person detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
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
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePersonDto) {
    return this.persons.updatePerson(id, dto);
  }

  /**
   * DELETE /api/v1/persons/:id
   * Delete a person (organizer only; blocked if has registrations).
   */
  @Delete('persons/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a person (only if no registrations)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 400, description: 'Has registrations — cannot delete' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.persons.deletePerson(id);
  }
}
