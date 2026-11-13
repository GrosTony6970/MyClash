/**
 * The camera QR scanner, shared by every app (`@myclash/ui/scan`).
 *
 * A subpath on purpose: the root barrel ships to every app and this pulls in a
 * lazily-loaded decoder, so only the surfaces that scan import it.
 */
export { useCameraScanner } from './useCameraScanner';
export type { CameraScanner } from './useCameraScanner';
export type { CameraError } from './camera';
export { cameraErrorKey } from './camera-error';
