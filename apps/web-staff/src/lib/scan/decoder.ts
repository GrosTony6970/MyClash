/**
 * QR decoding — the one seam.
 *
 * `jsQR` and nothing else, deliberately. The obvious alternative is
 * `BarcodeDetector` with jsQR as a fallback, which is faster on Chrome/Android
 * and ships no bytes there at all — but it means the desk runs one decoder in
 * some venues and a different one in others, and whichever your event does not
 * use is the one that rots untested. A single path behaves identically on every
 * tablet and reproduces on a dev machine. Firefox desktop and iOS Safari have no
 * BarcodeDetector at all, and an iPad is exactly what gets borrowed for a desk.
 *
 * Dynamically imported so the ~13KB never lands in the initial bundle for the
 * scoring pad, the pistes list or the login page — none of which scan anything.
 */

export type Decoder = (frame: ImageData) => string | null;

let cached: Promise<Decoder> | null = null;

/**
 * Load the decoder. Repeat calls share one import.
 *
 * `dontInvert`: an event pass is dark-on-white (the two existing QR sites in
 * this repo force `bg-white` for the same reason), so trying inverted variants
 * only costs frames on a device that is already the slow part.
 */
export function loadDecoder(): Promise<Decoder> {
  cached ??= import('jsqr').then(({ default: jsQR }) => {
    return (frame: ImageData) =>
      jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data ??
      null;
  });
  return cached;
}
