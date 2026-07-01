import { Module } from '@nestjs/common';
import { GlobalPersonResolverService } from './global-person-resolver.service';

/**
 * Shared identity-resolution primitives. Kept standalone (depends only on the
 * global SupabaseModule) so both PersonsModule and RegistrationsModule can
 * import it without a circular dependency.
 */
@Module({
  providers: [GlobalPersonResolverService],
  exports: [GlobalPersonResolverService],
})
export class IdentityModule {}
