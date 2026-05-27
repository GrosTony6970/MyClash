import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseService } from '../supabase/supabase.service';
import { LeagueMembershipRequestsController } from './league-membership-requests.controller';
import { LeagueMembershipRequestsService } from './league-membership-requests.service';
import { LeagueScoringService } from './league-scoring.service';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [LeaguesController, LeagueMembershipRequestsController],
  providers: [
    // useFactory so Nest injects only SupabaseService — the constructor
    // param is optional and would otherwise trigger DI "cannot resolve"
    // for environments where SupabaseService isn't present.
    {
      provide: LeagueScoringService,
      useFactory: (supabase: SupabaseService) => new LeagueScoringService(supabase),
      inject: [SupabaseService],
    },
    LeaguesService,
    LeagueMembershipRequestsService,
  ],
  exports: [LeagueScoringService, LeaguesService, LeagueMembershipRequestsService],
})
export class LeaguesModule {}
