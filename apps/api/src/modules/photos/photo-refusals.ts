import type { PhotoUploadRefusal } from '@myclash/types';
import { OperationalUnavailableException } from '../../common/operational-exception';

/**
 * "Photos are unavailable right now, try again": the bucket is missing or failed, or a read the
 * upload needs did not answer. A 503 through the operational marker, so its sentence reaches the
 * page; never a refusal that reads as the sender's fault (ruling 461).
 */
export const photosUnavailable = () =>
  new OperationalUnavailableException({
    code: 'photos_unavailable',
    message: 'Photos are unavailable right now, try again.',
  } satisfies { code: PhotoUploadRefusal; message: string });
