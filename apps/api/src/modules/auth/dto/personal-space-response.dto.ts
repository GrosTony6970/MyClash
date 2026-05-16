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
}
