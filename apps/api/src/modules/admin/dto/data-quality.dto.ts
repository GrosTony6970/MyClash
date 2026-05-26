import { IsIn, IsOptional } from 'class-validator';

export type DataQualityFindingStatus = 'open' | 'dismissed' | 'resolved';

export class UpdateDataQualityFindingDto {
  @IsIn(['open', 'dismissed', 'resolved'])
  status!: DataQualityFindingStatus;
}

export type DataQualityScanMode = 'ai' | 'deterministic';

export class StartDataQualityScanDto {
  /**
   * `ai` (default) runs the LLM-ranked path — costs per call.
   * `deterministic` skips the LLM, persists rule-derived candidates
   * with confidence = 1.0. Used by the daily cron + the operator's
   * "Run deterministic scan" button.
   */
  @IsOptional()
  @IsIn(['ai', 'deterministic'])
  mode?: DataQualityScanMode;
}
