import { Global, Module } from '@nestjs/common';
import { UserDirectoryService } from './user-directory.service';

/**
 * Global so any module can inject UserDirectoryService without re-importing.
 * Depends only on the (also-global) SupabaseService.
 */
@Global()
@Module({
  providers: [UserDirectoryService],
  exports: [UserDirectoryService],
})
export class UserDirectoryModule {}
