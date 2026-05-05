import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ArchiveService } from './archive.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [ExportsController],
  providers: [ArchiveService, ExportsService],
  exports: [ArchiveService, ExportsService],
})
export class ExportsModule {}
