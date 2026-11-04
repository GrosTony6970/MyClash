import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationsModule } from '../organizations/organizations.module';
import { photoStoreOf, readPhotoBucketSetting } from './photo-bucket';
import { PhotoDeviceService } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { PHOTO_STORE, PhotoUploadService } from './photo-upload.service';
import { PhotosController } from './photos.controller';

@Module({
  imports: [OrganizationsModule],
  controllers: [PhotosController],
  providers: [
    PhotoUploadService,
    PhotoDeviceService,
    PhotoLinkService,
    {
      provide: PHOTO_STORE,
      useFactory: (config: ConfigService) =>
        photoStoreOf(readPhotoBucketSetting((key) => config.get<string>(key))),
      inject: [ConfigService],
    },
  ],
})
export class PhotosModule {}
