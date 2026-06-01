import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Body for POST /api/v1/tournaments/:tournamentId/populate-bracket.
 *
 * Drives bracket R1 seeding from either the global cross-pool ranking
 * or a cross-pool snake fan-out of each pool's top-N qualifiers.
 */
export class PopulateBracketDto {
  @ApiPropertyOptional({
    enum: ['overall', 'top-n-per-pool'],
    description:
      "Seeding mode. 'overall' uses the global cross-pool standings; 'top-n-per-pool' takes top-N from each pool and snakes them across the bracket so same-pool fighters fall in opposite halves. Defaults to 'overall'.",
  })
  @IsOptional()
  @IsIn(['overall', 'top-n-per-pool'])
  seedingMode?: 'overall' | 'top-n-per-pool';

  @ApiPropertyOptional({
    description:
      'Required when seedingMode = "top-n-per-pool". How many fighters from each pool advance to the bracket.',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  topNPerPool?: number;
}
