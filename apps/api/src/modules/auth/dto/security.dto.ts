import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MaxLength(256)
  newPassword!: string;
}

export class DeleteAccountDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({ enum: ['DELETE'] })
  @IsIn(['DELETE'])
  confirmation!: 'DELETE';
}
