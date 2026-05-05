import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LeagueScoringService } from './league-scoring.service';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [LeaguesController],
  providers: [LeagueScoringService, LeaguesService],
  exports: [LeagueScoringService, LeaguesService],
})
export class LeaguesModule {}
