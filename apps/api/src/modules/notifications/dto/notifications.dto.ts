import { Type } from 'class-transformer';
import { IsString, IsUrl, MinLength, ValidateNested } from 'class-validator';

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
