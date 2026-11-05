import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PHOTO_CLEANUP_QUEUE } from '../../workers/photo-cleanup.worker';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhotoDeviceService } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { PhotoModerationService } from './photo-moderation.service';
import { photoStoreProvider } from './photo-store.provider';
import { PhotoUploadService } from './photo-upload.service';
import { PhotosController } from './photos.controller';

@Module({
  // The clean-up queue, registered here too so a moderator's delete can ask for a drain now
  // (as `hema-ratings.module.ts` does for its own queue).
  imports: [OrganizationsModule, BullModule.registerQueue({ name: PHOTO_CLEANUP_QUEUE })],
  controllers: [PhotosController],
  providers: [
    PhotoUploadService,
    PhotoDeviceService,
    PhotoLinkService,
    PhotoModerationService,
    photoStoreProvider,
  ],
})
export class PhotosModule {}
