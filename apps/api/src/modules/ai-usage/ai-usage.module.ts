import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AIProvidersModule } from '../ai-providers/ai-providers.module';
import { AIUsageController } from './ai-usage.controller';
import { AIUsageService } from './ai-usage.service';

@Module({
  imports: [SupabaseModule, AIProvidersModule],
  controllers: [AIUsageController],
  providers: [AIUsageService],
  exports: [AIUsageService],
})
export class AIUsageModule {}
