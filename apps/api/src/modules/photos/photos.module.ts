import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PHOTO_CLEANUP_QUEUE } from '../../workers/photo-cleanup.worker';
import { MeModule } from '../me/me.module';
import { MyPhotosController } from './my-photos.controller';
import { MyPhotosService } from './my-photos.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhotoDeviceService } from './photo-device';
import { PhotoDownloadService } from './photo-download.service';
import { PhotoLinkService } from './photo-link.service';
import { PhotoModerationService } from './photo-moderation.service';
import { PhotoPlatformController } from './photo-platform.controller';
import { PhotoPlatformService } from './photo-platform.service';
import { PhotoPublicService } from './photo-public.service';
import { photoStoreProvider } from './photo-store.provider';
import { PhotoUploadService } from './photo-upload.service';
import { StaffModule } from '../staff/staff.module';
import { PhotosController } from './photos.controller';
import { PhotosStaffController } from './photos-staff.controller';

@Module({
  // The clean-up queue, registered here too so a moderator's delete can ask for a drain now
  // (as `hema-ratings.module.ts` does for its own queue).
  // StaffModule: the `photos` staff job's gate (`StaffService.requireStaffWithRole`).
  // MeModule: a signed-in upload's "one of her Events" (`MeEventsService.listMyEvents`).
  imports: [
    OrganizationsModule,
    StaffModule,
    MeModule,
    BullModule.registerQueue({ name: PHOTO_CLEANUP_QUEUE }),
  ],
  // PhotoPlatformController: the platform's Photos page (ruling 493), behind `PlatformRoleGuard`,
  // which resolves here as in PrivacyModule (`SupabaseService` is global).
  controllers: [
    PhotosController,
    PhotosStaffController,
    MyPhotosController,
    PhotoPlatformController,
  ],
  providers: [
    MyPhotosService,
    PhotoPlatformService,
    PhotoUploadService,
    PhotoDeviceService,
    PhotoLinkService,
    PhotoModerationService,
    PhotoPublicService,
    PhotoDownloadService,
    photoStoreProvider,
  ],
})
export class PhotosModule {}
