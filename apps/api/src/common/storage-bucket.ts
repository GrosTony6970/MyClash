import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../modules/supabase/supabase.service';

type Storage = SupabaseService['service']['storage'];

/**
 * Creates a public image bucket on its first use: a new server has none. A bucket another
 * request created meanwhile ("already exists") is not an error.
 */
export async function ensurePublicBucket(
  storage: Storage,
  name: string,
  maxBytes: number,
  mimeTypes: ReadonlySet<string>,
): Promise<void> {
  const { data, error } = await storage.getBucket(name);
  if (data && !error) return;
  const created = await storage.createBucket(name, {
    public: true,
    fileSizeLimit: maxBytes,
    allowedMimeTypes: Array.from(mimeTypes),
  });
  if (created.error && !/already exists/iu.test(created.error.message)) {
    throw new BadRequestException(created.error.message);
  }
}
