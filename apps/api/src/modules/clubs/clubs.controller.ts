import {
  Body,
  Controller,
  DefaultValuePipe,
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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { ClubsService, type DeleteClubMode } from './clubs.service';
import { ClubQueryDto, CreateClubDto, UpdateClubDto } from './dto/clubs.dto';

@ApiTags('clubs')
@Controller('clubs')
export class ClubsController {
  constructor(private readonly clubs: ClubsService) {}

  /** GET /api/v1/clubs?q=...&country=... */
  @Get()
  @ApiOperation({ summary: 'List clubs (public)' })
  async list(@Query() query: ClubQueryDto) {
    return this.clubs.list(query);
  }

  /** GET /api/v1/clubs/:slug */
  @Get(':slug')
  @ApiOperation({ summary: 'Get club by slug (public)' })
  async getBySlug(@Param('slug') slug: string) {
    return this.clubs.getBySlug(slug);
  }

  /** POST /api/v1/clubs */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a club (organizer+)' })
  async create(@Body() dto: CreateClubDto) {
    return this.clubs.create(dto);
  }

  /** PATCH /api/v1/clubs/:id */
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a club (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClubDto) {
    return this.clubs.update(id, dto);
  }

  /** POST /api/v1/clubs/:id/logo */
  @Post(':id/logo')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload a club logo (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async uploadLogo(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          | {
              filename: string;
              mimetype: string;
              toBuffer: () => Promise<Buffer>;
            }
          | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.clubs.uploadLogo(id, {
      buffer,
      filename: data?.filename ?? '',
      mimetype: data?.mimetype ?? '',
    });
  }

  /** DELETE /api/v1/clubs/:id?mode=safe|archive|cleanup */
  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Delete or archive a club (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('mode', new DefaultValuePipe('safe')) mode: DeleteClubMode,
  ) {
    return this.clubs.deleteClub(id, mode);
  }
}
