import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
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

export class SendBroadcastNotificationDto {
  @IsIn(['all', 'fighters', 'referees', 'fighters_and_referees', 'specific_persons'])
  targetType!: 'all' | 'fighters' | 'referees' | 'fighters_and_referees' | 'specific_persons';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  personIds?: string[];

  @IsOptional()
  @IsUUID('4')
  tournamentId?: string;

  @IsIn(['info', 'warning', 'alert'])
  severity!: 'info' | 'warning' | 'alert';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;
}
