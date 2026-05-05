import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class CreateStaffAccountDto {
  @IsString()
  @Length(1, 120)
  displayName!: string;

  @IsString()
  @Length(3, 64)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username!: string;

  @IsString()
  @Length(4, 12)
  @Matches(/^[0-9]+$/)
  pin!: string;

  @IsOptional()
  @IsIn(['arbitre_table', 'event_staff'])
  role?: 'arbitre_table' | 'event_staff';
}

export class UpdateStaffAccountDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(3, 64)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username?: string;

  @IsOptional()
  @IsIn(['arbitre_table', 'event_staff'])
  role?: 'arbitre_table' | 'event_staff';

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}

export class ResetStaffPinDto {
  @IsString()
  @Length(4, 12)
  @Matches(/^[0-9]+$/)
  pin!: string;
}

export class SetStaffLicesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(64)
  @IsUUID('4', { each: true })
  liceIds!: string[];
}

export class StaffLoginDto {
  @IsString()
  @Length(1, 160)
  eventSlugOrCode!: string;

  @IsString()
  @Length(3, 64)
  username!: string;

  @IsString()
  @Length(4, 12)
  pin!: string;
}
