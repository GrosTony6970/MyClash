import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RulesetsModule } from '../rulesets/rulesets.module';
import { ArchiveService } from './archive.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  // RulesetsModule: a restore keeps only a ruleset pair the picker's scope
  // allows. It imports Organizations and the resolver only, so no cycle.
  imports: [OrganizationsModule, RulesetsModule],
  controllers: [ExportsController],
  providers: [ArchiveService, ExportsService],
  exports: [ArchiveService, ExportsService],
})
export class ExportsModule {}
