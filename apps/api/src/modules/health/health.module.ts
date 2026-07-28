import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';

@Module({
  controllers: [HealthController, VersionController],
  providers: [
    // useFactory, not a plain provider: the constructor's only parameter is
    // `VersionServiceOptions` (a test seam), and an interface has no runtime
    // token — so Nest tries to inject it and dies at boot with "Can't resolve
    // dependencies of the VersionService (?)". A default value does not help;
    // Nest reads design:paramtypes, not defaults. Same reason, same fix as
    // AdminSystemVersionsService in admin.module.ts.
    { provide: VersionService, useFactory: () => new VersionService() },
  ],
})
export class HealthModule {}
