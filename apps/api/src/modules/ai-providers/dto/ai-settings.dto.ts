import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import type { AIProvider } from '../adapters/provider-adapter.interface';

export class SaveAISettingsDto {
  @ApiProperty({ enum: ['anthropic', 'openai', 'mistral'] })
  @IsIn(['anthropic', 'openai', 'mistral'])
  provider!: AIProvider;

  @ApiProperty({ example: 'sk-ant-...' })
  @IsString()
  @MinLength(10)
  apiKey!: string;
}
