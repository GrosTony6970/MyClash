/**
 * The camera half of the scan lane, with no React in it.
 *
 * Split from the hook so the two decisions that carry product meaning — which
 * failure a volunteer is looking at, and when a decoded symbol counts as a NEW
 * scan — are unit-testable. Neither is obvious, and both are wrong in ways that
 * only show up with a queue in front of you.
 */

/** Why the viewfinder is not showing anything. */
export type CameraError =
  /** Not a secure context, so `mediaDevices` does not exist at all. */
  | 'insecure'
  /** The volunteer said no, or said no once before on this origin. */
  | 'denied'
  /** No camera on this device. */
  | 'no_camera'
  /** In use by another app, or the driver refused. */
  | 'busy'
  /** Anything else. */
  | 'failed';

/**
 * A camera needs a SECURE CONTEXT.
 *
 * This is worth its own state because of how it fails: on an untrusted TLS
 * chain the browser silently omits `navigator.mediaDevices` entirely, so the
 * call site sees "undefined" rather than an error it can explain. The same
 * class of failure already cost this project weeks once — a click-through
 * certificate warning covers navigation but does not restore a secure context,
 * which is exactly how every realtime websocket got 403'd while the pages
 * looked fine.
 */
export function cameraUnavailableReason(): CameraError | null {
  if (typeof window === 'undefined') return 'failed';
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'insecure';
  return null;
}

/**
 * Map a getUserMedia rejection onto something a volunteer can act on.
 *
 * The DOMException names are the contract here, not the messages — those are
 * localised by the browser and differ per engine.
 */
export function classifyCameraError(err: unknown): CameraError {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_camera';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'failed';
}

/**
 * The rear camera, at a resolution a decoder can actually work with.
 *
 * `environment` rather than the default: a desk tablet is held facing the
 * fighter, and the front camera would frame the volunteer.
 */
function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
}

/** Either a live stream or the reason there isn't one. Never both, never neither. */
export type CameraStart =
  { stream: MediaStream; error: null } | { stream: null; error: CameraError };

/**
 * Start the camera, resolving with the failure rather than throwing it.
 *
 * One entry point, always asynchronous, even for the synchronous
 * secure-context check. That is what lets the caller keep every `setState` in a
 * `.then()` — `react-hooks/set-state-in-effect` is an ERROR in this repo, and an
 * effect body that branches into a synchronous setState for the insecure case
 * would be writing around the rule rather than through it.
 */
export function startCamera(): Promise<CameraStart> {
  const blocked = cameraUnavailableReason();
  if (blocked) return Promise.resolve({ stream: null, error: blocked });

  return openCamera().then(
    (stream) => ({ stream, error: null }) as CameraStart,
    (err: unknown) => ({ stream: null, error: classifyCameraError(err) }) as CameraStart,
  );
}

/**
 * Release the camera.
 *
 * Every track, explicitly. Dropping the reference is not enough — the hardware
 * light stays on and the next surface to ask gets `NotReadableError`, which the
 * volunteer reads as "the scanner is broken".
 */
export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Milliseconds a token is ignored for after it has been accepted once. */
export const REPEAT_SUPPRESSION_MS = 4000;

export interface ScanMemory {
  token: string | null;
  at: number;
}

/**
 * Is this decoded symbol a NEW scan?
 *
 * A QR held in front of a camera decodes on every single frame, so without this
 * one fighter standing still would fire a dozen identical requests a second.
 * Suppressing by TIME rather than forever is the important half: the same
 * person legitimately re-presents their pass — a mis-scan the volunteer undid,
 * or a fighter coming back after being sent away for gear — and a permanent
 * dedupe would silently refuse them with no way to explain why.
 */
export function isNewScan(token: string, memory: ScanMemory, now: number): boolean {
  if (memory.token !== token) return true;
  return now - memory.at >= REPEAT_SUPPRESSION_MS;
}

/**
 * Pull a frame out of the video element as pixels the decoder can read.
 *
 * Returns null until the stream has real dimensions — a `<video>` reports 0×0
 * for the first frames after `play()`, and `getImageData` on a zero-sized
 * canvas throws.
 */
export function grabFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const { videoWidth: width, videoHeight: height } = video;
  if (!width || !height) return null;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}
