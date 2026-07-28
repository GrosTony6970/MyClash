import { Global, Module } from '@nestjs/common';
import { EntityLabelService } from './entity-label.service';

/**
 * Global for the same reason UserDirectoryModule is: label resolution is a
 * cross-cutting read that both super-admin and organiser surfaces need, and it
 * is a leaf — it depends on nothing but Supabase and the user directory.
 *
 * Importing it explicitly would mean MatchesModule importing AdminModule, which
 * closes a cycle (AdminModule already imports MatchesModule). Leaf-extraction is
 * the fix for that, not forwardRef.
 */
@Global()
@Module({
  providers: [EntityLabelService],
  exports: [EntityLabelService],
})
export class EntityLabelModule {}
