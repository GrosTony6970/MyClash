import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', description: 'Always "ok" when the process is alive' })
  status!: 'ok';

  @ApiProperty({ example: 42.3, description: 'Process uptime in seconds' })
  uptime!: number;
}
