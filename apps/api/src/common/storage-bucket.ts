import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { SupabaseService } from '../modules/supabase/supabase.service';
import { storageGaveNoAnswer } from './storage-answer';

type Storage = SupabaseService['service']['storage'];

/**
 * Creates a public image bucket on its first use: a new server has none. A bucket another
 * request created meanwhile ("already exists") is not an error. When storage gave no answer
 * (it is down, or the storage timeout fired), nothing is created: asking again would only wait
 * a second time. That is a 503, reported like any server fault, not the caller's mistake.
 */
export async function ensurePublicBucket(
  storage: Storage,
  name: string,
  maxBytes: number,
  mimeTypes: ReadonlySet<string>,
): Promise<void> {
  const { data, error } = await storage.getBucket(name);
  if (data && !error) return;
  if (storageGaveNoAnswer(error)) throw new ServiceUnavailableException('Storage gave no answer');
  const created = await storage.createBucket(name, {
    public: true,
    fileSizeLimit: maxBytes,
    allowedMimeTypes: Array.from(mimeTypes),
  });
  if (storageGaveNoAnswer(created.error)) {
    throw new ServiceUnavailableException('Storage gave no answer');
  }
  if (created.error && !/already exists/iu.test(created.error.message)) {
    throw new BadRequestException(created.error.message);
  }
}
