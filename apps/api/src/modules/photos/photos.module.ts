import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhotoDeviceService } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { photoStoreProvider } from './photo-store.provider';
import { PhotoUploadService } from './photo-upload.service';
import { PhotosController } from './photos.controller';

@Module({
  imports: [OrganizationsModule],
  controllers: [PhotosController],
  providers: [PhotoUploadService, PhotoDeviceService, PhotoLinkService, photoStoreProvider],
})
export class PhotosModule {}
