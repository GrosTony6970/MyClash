import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * Re-apply Round 1 seeding to an already-generated bracket without
 * destroying the existing matches.
 */
export class ReseedBracketDto {
  @ApiProperty({
    enum: ['snake', 'by-rating', 'random', 'by-pool-rank'],
    description: 'Seeding strategy. Only `snake` is implemented today; the others return 501.',
  })
  @IsIn(['snake', 'by-rating', 'random', 'by-pool-rank'])
  strategy!: 'snake' | 'by-rating' | 'random' | 'by-pool-rank';
}
