import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { GoogleAdapter } from './adapters/google.adapter';
import { MistralAdapter } from './adapters/mistral.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { AIModelsController } from './ai-models.controller';
import { AIProvidersController } from './ai-providers.controller';
import { AIProvidersService } from './ai-providers.service';

@Module({
  imports: [SupabaseModule, OrganizationsModule],
  controllers: [AIProvidersController, AIModelsController],
  providers: [AIProvidersService, AnthropicAdapter, OpenAIAdapter, MistralAdapter, GoogleAdapter],
  exports: [AIProvidersService],
})
export class AIProvidersModule {}
