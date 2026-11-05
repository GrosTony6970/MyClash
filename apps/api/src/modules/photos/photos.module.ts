import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PHOTO_CLEANUP_QUEUE } from '../../workers/photo-cleanup.worker';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhotoDeviceService } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { PhotoModerationService } from './photo-moderation.service';
import { photoStoreProvider } from './photo-store.provider';
import { PhotoUploadService } from './photo-upload.service';
import { StaffModule } from '../staff/staff.module';
import { PhotosController } from './photos.controller';
import { PhotosStaffController } from './photos-staff.controller';

@Module({
  // The clean-up queue, registered here too so a moderator's delete can ask for a drain now
  // (as `hema-ratings.module.ts` does for its own queue).
  // StaffModule: the `photos` staff job's gate (`StaffService.requireStaffWithRole`).
  imports: [
    OrganizationsModule,
    StaffModule,
    BullModule.registerQueue({ name: PHOTO_CLEANUP_QUEUE }),
  ],
  controllers: [PhotosController, PhotosStaffController],
  providers: [
    PhotoUploadService,
    PhotoDeviceService,
    PhotoLinkService,
    PhotoModerationService,
    photoStoreProvider,
  ],
})
export class PhotosModule {}
