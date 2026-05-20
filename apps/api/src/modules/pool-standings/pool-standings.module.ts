import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PoolStandingsController } from './pool-standings.controller';
import { PoolStandingsService } from './pool-standings.service';

@Module({
  imports: [SupabaseModule],
  controllers: [PoolStandingsController],
  providers: [PoolStandingsService],
})
export class PoolStandingsModule {}
