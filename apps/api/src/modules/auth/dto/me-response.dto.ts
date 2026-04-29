import { ApiProperty } from '@nestjs/swagger';

export class MeResponseDto {
  @ApiProperty({ enum: ['claimed', 'guest', 'anonymous'] })
  type!: 'claimed' | 'guest' | 'anonymous';

  @ApiProperty({ required: false })
  user?: {
    id: string;
    email: string;
    display_name?: string;
  };

  @ApiProperty({ required: false })
  person?: {
    id: string;
    given_name: string;
    family_name: string;
    event_id: string;
    claim_status: string;
  };

  /** Present only when type='guest' */
  @ApiProperty({ required: false })
  session?: {
    device_label: string;
    expires_at: string;
  };
}
