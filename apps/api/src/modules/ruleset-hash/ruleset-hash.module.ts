import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { RulesetHashService } from './ruleset-hash.service';

/**
 * Read-only content-hash assembler. A leaf module (SupabaseModule only) so any
 * consumer — events (stamp the tournament), match generation (stamp matches),
 * public standings (drift indicator) — can import it without a DI cycle.
 */
@Module({
  imports: [SupabaseModule],
  providers: [RulesetHashService],
  exports: [RulesetHashService],
})
export class RulesetHashModule {}
