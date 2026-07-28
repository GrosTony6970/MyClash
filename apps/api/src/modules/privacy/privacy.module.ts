/**
 * privacy.module.ts — GDPR data-subject rights.
 *
 * Deliberately imports nothing: SupabaseModule is @Global, and staying
 * dependency-free lets AuthModule import THIS module for ErasureService without
 * creating a cycle (which would only surface at real boot).
 */
import { Module } from '@nestjs/common';
import { ErasureService } from './erasure.service';
import { PrivacyAdminController } from './privacy-admin.controller';
import { RetentionService } from './retention.service';
import { SubjectExportController } from './subject-export.controller';
import { SubjectExportService } from './subject-export.service';

@Module({
  controllers: [SubjectExportController, PrivacyAdminController],
  providers: [SubjectExportService, ErasureService, RetentionService],
  exports: [ErasureService, RetentionService],
})
export class PrivacyModule {}
