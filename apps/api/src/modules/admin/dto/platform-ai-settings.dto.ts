import { IsIn, IsString, MinLength } from 'class-validator';
import type { AIProvider } from '../../ai-providers/adapters/provider-adapter.interface';

export class SavePlatformAISettingsDto {
  @IsIn(['anthropic', 'openai', 'mistral'])
  provider!: AIProvider;

  @IsString()
  @MinLength(10)
  apiKey!: string;
}
