import { Module } from '@nestjs/common';
import { HealthController } from '../modules/health/health.controller';

/**
 * The worker's only HTTP: `GET /health`, the probe the image's HEALTHCHECK calls (ruling 807).
 * Its body stays HealthController's. Nothing else is imported, so the worker serves no route of
 * the API, and a test can build this module without loading AppModule.
 */
@Module({ controllers: [HealthController] })
export class WorkerHealthModule {}
