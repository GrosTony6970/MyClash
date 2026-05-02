import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PushSubscriptionKeysDto {
  @IsString()
  @MinLength(1)
  p256dh!: string;

  @IsString()
  @MinLength(1)
  auth!: string;
}

export class SubscribeDto {
  @IsUrl({ require_tld: false })
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  matchStartingMinutesBefore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  workshopStartingMinutesBefore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  refereeStartingMinutesBefore?: number;

  @IsOptional()
  @IsBoolean()
  scheduleChanges?: boolean;

  @IsOptional()
  @IsBoolean()
  resultsPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
