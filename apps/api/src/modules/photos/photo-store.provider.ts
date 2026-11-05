import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PHOTO_STORE, photoStoreOf, readPhotoBucketSetting, type PhotoStore } from './photo-bucket';

/**
 * The photo store, or null when the bucket is not configured. One provider for the two modules
 * that reach the bucket: the upload (PhotosModule) and the clean-up worker (WorkersModule).
 */
export const photoStoreProvider: FactoryProvider<PhotoStore | null> = {
  provide: PHOTO_STORE,
  useFactory: (config: ConfigService) =>
    photoStoreOf(readPhotoBucketSetting((key) => config.get<string>(key))),
  inject: [ConfigService],
};
