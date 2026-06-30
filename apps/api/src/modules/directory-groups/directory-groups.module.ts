import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module';
import { DirectoryGroupsController } from './directory-groups.controller';
import { DirectoryGroupsService } from './directory-groups.service';
import { MemberStatsService } from './member-stats.service';

@Module({
  imports: [FollowsModule],
  controllers: [DirectoryGroupsController],
  providers: [DirectoryGroupsService, MemberStatsService],
  exports: [DirectoryGroupsService],
})
export class DirectoryGroupsModule {}
