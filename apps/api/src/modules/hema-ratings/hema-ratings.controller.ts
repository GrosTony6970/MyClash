import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { HemaRatingsService } from './hema-ratings.service';

const hemaRatingsSearchQuerySchema = z
  .object({
    q: z.string().max(100),
    // Arrives as a query-string value; the controller parses it via parseInt.
    limit: z.string().optional(),
  })
  .strict();
class HemaRatingsSearchQueryDto extends createZodDto(hemaRatingsSearchQuerySchema) {}

@ApiTags('hema-ratings')
@Controller('hema-ratings')
export class HemaRatingsController {
  constructor(private readonly hemaRatings: HemaRatingsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search latest HEMA Ratings fighter snapshot' })
  @ApiQuery({ name: 'q', type: 'string' })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  async search(@Query() query: HemaRatingsSearchQueryDto) {
    const limit = parseInt(query.limit ?? '5', 10) || 5;
    return this.hemaRatings.search(query.q, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get enriched HEMA Ratings fighter profile' })
  async getProfile(@Param('id') id: string) {
    return this.hemaRatings.getProfile(id);
  }

  /**
   * Background sync of a single HEMA Ratings ID. Called by the
   * participant-add finder as fire-and-forget the moment the user picks
   * a suggestion — refreshes the snapshot entry so the next read
   * (search, registration enrichment, rating resolution) gets fresh
   * data without waiting on a full daily sync.
   *
   * Returns 202 immediately; the actual fetch + snapshot patch happen
   * before the response resolves but errors are intentionally swallowed
   * inside the service so a flaky upstream never surfaces to the form.
   */
  @Post('fighters/:hemaRatingsId/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Background-sync a single HEMA Ratings fighter' })
  @ApiParam({ name: 'hemaRatingsId', type: 'string' })
  async sync(@Param('hemaRatingsId') hemaRatingsId: string) {
    await this.hemaRatings.syncByHemaRatingsId(hemaRatingsId);
    return { accepted: true };
  }
}
