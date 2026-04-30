import {
  Body,
  Controller,
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
import { ClubsService } from './clubs.service';
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
}
