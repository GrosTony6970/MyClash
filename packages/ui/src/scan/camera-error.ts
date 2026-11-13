import type { CameraError } from './camera';

/** Literal keys, one per state — never assembled from a template. */
export function cameraErrorKey(error: CameraError): string {
  switch (error) {
    case 'insecure':
      return 'common.scan.cameraInsecure';
    case 'denied':
      return 'common.scan.cameraDenied';
    case 'no_camera':
      return 'common.scan.cameraMissing';
    case 'busy':
      return 'common.scan.cameraBusy';
    case 'failed':
      return 'common.scan.cameraFailed';
  }
}
