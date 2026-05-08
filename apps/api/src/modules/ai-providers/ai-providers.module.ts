import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { MistralAdapter } from './adapters/mistral.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { AIProvidersController } from './ai-providers.controller';
import { AIProvidersService } from './ai-providers.service';

@Module({
  imports: [SupabaseModule],
  controllers: [AIProvidersController],
  providers: [AIProvidersService, AnthropicAdapter, OpenAIAdapter, MistralAdapter],
  exports: [AIProvidersService],
})
export class AIProvidersModule {}
