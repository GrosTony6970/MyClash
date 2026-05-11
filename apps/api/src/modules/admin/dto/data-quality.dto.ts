import { IsIn } from 'class-validator';

export type DataQualityFindingStatus = 'open' | 'dismissed' | 'resolved';

export class UpdateDataQualityFindingDto {
  @IsIn(['open', 'dismissed', 'resolved'])
  status!: DataQualityFindingStatus;
}
