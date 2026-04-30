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
import { PersonsService } from './persons.service';
import { CreatePersonDto, UpdatePersonDto } from './dto/persons.dto';

/** Extract authenticated user ID from request (set by Supabase JWT). */
function getUserId(req: FastifyRequest): string {
  return (req as FastifyRequest & { userId?: string }).userId ?? 'unknown';
}

@ApiTags('persons')
@ApiBearerAuth()
@Controller()
export class PersonsController {
  constructor(private readonly persons: PersonsService) {}

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
    return this.persons.createPerson(eventId, dto, getUserId(req));
  }

  /**
   * POST /api/v1/events/:eventId/persons/import
   * CSV bulk import (organizer only).
   * Accepts multipart/form-data with a 'file' field containing the CSV.
   */
  @Post('events/:eventId/persons/import')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Import persons from CSV' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Import report' })
  async importCsv(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    // Read multipart file via @fastify/multipart
    let buffer: Buffer | null = null;
    try {
      const data = await (
        req as FastifyRequest & {
          file: () => Promise<{ toBuffer: () => Promise<Buffer> } | null>;
        }
      ).file();
      if (data) {
        buffer = await data.toBuffer();
      }
    } catch {
      // no file
    }

    if (!buffer) {
      return {
        created: 0,
        updated: 0,
        duplicates: [],
        newClubsForReview: [],
        invalid: [{ row: 0, reason: 'No file uploaded', raw: '' }],
      };
    }
    return this.persons.importCsv(eventId, buffer, getUserId(req));
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
