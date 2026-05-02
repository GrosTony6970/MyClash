import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { HemaRatingsService } from './hema-ratings.service';

class HemaRatingsSearchQueryDto {
  @IsString()
  @MaxLength(100)
  q!: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

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
}
