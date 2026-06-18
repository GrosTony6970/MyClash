import { ApiProperty } from '@nestjs/swagger';

export class PersonalSpaceResponseDto {
  @ApiProperty()
  user!: {
    id: string;
    email: string;
    display_name?: string;
  };

  @ApiProperty()
  profiles!: {
    globalPerson: Record<string, unknown> | null;
    claimedPersons: Record<string, unknown>[];
  };

  @ApiProperty()
  commitments!: {
    refereeAssignments: Record<string, unknown>[];
    workshopEnrollments: Record<string, unknown>[];
  };

  @ApiProperty()
  counts!: {
    claimedPersons: number;
    events: number;
    refereeAssignments: number;
    workshopEnrollments: number;
  };

  /** Unclaimed roster profiles whose registered email matches the user's —
   *  surfaced for a one-tap confirm-to-claim on the dashboard. */
  @ApiProperty()
  claimable!: Array<{ id: string; name: string; eventName: string; roles: unknown }>;
}
