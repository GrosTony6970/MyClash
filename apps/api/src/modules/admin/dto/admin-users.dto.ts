import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ORG_ROLES = [
  'owner',
  'admin',
  'editor',
  'scorekeeper',
  'referee',
  'workshop_lead',
  'read_only',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export class CreatePlatformUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  makeSuperAdmin?: boolean;
}

export class UpdatePlatformUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}

export class AddOrgMembershipDto {
  @IsUUID()
  organizationId!: string;

  @IsIn(ORG_ROLES)
  role!: OrgRole;
}

export class UpdateOrgMembershipRoleDto {
  @IsIn(ORG_ROLES)
  role!: OrgRole;
}
