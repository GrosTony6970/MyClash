import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CreateFighterDto {
  @ApiProperty({ example: 'Jean' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  givenName!: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  familyName!: string;

  @ApiProperty({ example: 'Jean Dupont' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  hemaRatingsId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  genderCategory?: string;
}

export class UpdateFighterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  givenName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  familyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  hemaRatingsId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;
}

export class FighterClubInputDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clubName?: string;
}

export class FighterWeaponInputDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  weaponId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  weaponName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;
}

export class UpdateMyFighterProfileDto extends UpdateFighterDto {
  @ApiProperty({ description: 'Global Fighter profile ID being edited' })
  @IsUUID()
  fighterId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  mainClub?: FighterClubInputDto;

  @ApiProperty({ required: false, type: [FighterClubInputDto] })
  @IsOptional()
  @IsArray()
  secondaryClubs?: FighterClubInputDto[];

  @ApiProperty({ required: false, type: [FighterClubInputDto] })
  @IsOptional()
  @IsArray()
  previousClubs?: FighterClubInputDto[];

  @ApiProperty({ required: false, type: [FighterWeaponInputDto] })
  @IsOptional()
  @IsArray()
  weapons?: FighterWeaponInputDto[];
}

export class FighterQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  club?: string;
}

export class PromoteFighterDto {
  @ApiProperty({ description: 'Person ID to promote to global Fighter' })
  @IsUUID()
  personId!: string;
}

export class MergeFightersDto {
  @ApiProperty({ description: 'Source fighter ID (will be merged into target)' })
  @IsUUID()
  sourceId!: string;

  @ApiProperty({ description: 'Target fighter ID (kept after merge)' })
  @IsUUID()
  targetId!: string;

  @ApiProperty({ required: false, description: 'Reason shown in the merge audit log' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateGlobalPersonDto {
  @ApiProperty({ example: 'Jean' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  givenName!: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  familyName!: string;

  @ApiProperty({ example: 'Jean Dupont' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  clubId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clubName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  clubAbbreviation?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clubCity?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  hemaRatingsId?: string;

  @ApiProperty({ required: false, format: 'email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiProperty({ required: false, description: 'ISO YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must be ISO YYYY-MM-DD',
  })
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isFighter?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isReferee?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isWorkshopParticipant?: boolean;
}

export class UpdateGlobalPersonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  givenName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  familyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  clubId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clubName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  clubAbbreviation?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clubCity?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  hemaRatingsId?: string | null;

  @ApiProperty({ required: false, format: 'email', nullable: true })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null && value !== '')
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null && value !== '')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must be ISO YYYY-MM-DD',
  })
  dateOfBirth?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isFighter?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isReferee?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isWorkshopParticipant?: boolean;
}

export class FighterRolesDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isFighter?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isReferee?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isWorkshopParticipant?: boolean;
}

export class GlobalPersonQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiProperty({
    required: false,
    type: [String],
    enum: ['fighter', 'referee', 'workshop_participant'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(['fighter', 'referee', 'workshop_participant'], { each: true })
  roles?: string[];
}

export class RefereeProfileDto {
  @ApiProperty({ required: false, type: [Object] })
  @IsOptional()
  @IsArray()
  certifications?: object[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class LinkQualificationDto {
  @ApiProperty({ description: 'Referee qualification ID to link to this global person' })
  @IsUUID()
  qualificationId!: string;
}

export class LinkEnrollmentDto {
  @ApiProperty({ description: 'Workshop enrollment ID to link to this global person' })
  @IsUUID()
  enrollmentId!: string;
}

export class ImportDecisionDto {
  @ApiProperty({ description: 'Source row number (CSV line)' })
  @IsInt()
  @Min(0)
  index!: number;

  @ApiProperty({ enum: ['skip', 'create_new', 'overwrite'] })
  @IsIn(['skip', 'create_new', 'overwrite'])
  action!: 'skip' | 'create_new' | 'overwrite';

  @ApiProperty({ required: false, description: 'Existing global person id when action=overwrite' })
  @IsOptional()
  @IsUUID()
  targetGlobalPersonId?: string;

  @ApiProperty()
  @IsString()
  givenName!: string;

  @ApiProperty()
  @IsString()
  familyName!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  hemaRatingsId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ required: false, description: 'ISO YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clubLabel?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clubAbbreviation?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clubCity?: string;

  @ApiProperty()
  @IsBoolean()
  isFighter!: boolean;

  @ApiProperty()
  @IsBoolean()
  isReferee!: boolean;

  @ApiProperty()
  @IsBoolean()
  isWorkshopParticipant!: boolean;
}

export class ImportCommitDto {
  @ApiProperty({ type: [ImportDecisionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportDecisionDto)
  decisions!: ImportDecisionDto[];
}
