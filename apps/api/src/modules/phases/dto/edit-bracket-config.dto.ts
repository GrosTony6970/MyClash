import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Post-generation bracket configuration edit.
 * Currently only grandFinalReset (double-elim) is editable.
 */
export class EditBracketConfigDto {
  @ApiProperty({ required: false, description: 'Double-elim only.' })
  @IsOptional()
  @IsBoolean()
  grandFinalReset?: boolean;
}
