/**
 * Zoom maths for the logo cropper. Kept pure (no react-easy-crop / DOM) so
 * the fit logic is unit-testable; the modal maps react-easy-crop's
 * `mediaSize`/`cropSize` onto these plain `{ width, height }` inputs.
 */
export interface Size {
  width: number;
  height: number;
}

/**
 * Smallest zoom the slider always offers. Guarantees zoom-out room even for
 * logos that already fit at 1× (square / small), and — because any logo whose
 * exact-fit zoom is ≥ this value fits at this value too — the whole logo is
 * always visible at `computeMinZoom`.
 */
export const ZOOM_OUT_FLOOR = 0.5;

function isValid(size: Size | null): size is Size {
  return (
    size !== null &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/**
 * Minimum zoom for the cropper given the rendered media size and the square
 * crop size (both as displayed at zoom 1, in react-easy-crop's space).
 *
 * Returns the smaller of the exact "whole logo fits the crop" zoom and
 * {@link ZOOM_OUT_FLOOR}. Falls back to the floor before sizes are known.
 */
export function computeMinZoom(media: Size | null, crop: Size | null): number {
  if (!isValid(media) || !isValid(crop)) return ZOOM_OUT_FLOOR;
  const fit = Math.min(crop.width / media.width, crop.height / media.height);
  if (!Number.isFinite(fit) || fit <= 0) return ZOOM_OUT_FLOOR;
  return Math.min(fit, ZOOM_OUT_FLOOR);
}

/** A person's photo is baked at most this wide, as the public site's avatar cropper does. */
export const PHOTO_SIDE_MAX = 512;

/**
 * The canvas a crop is baked into. A logo keeps the source's own pixels. A photo is scaled down
 * to `PHOTO_SIDE_MAX` on its longer side: a phone portrait's crop at full size, as a PNG, is
 * larger than the 15 MB the server takes, though the picked file was 4 MB.
 */
export function bakedSize(area: Size, photo: boolean): Size {
  const scale = photo ? Math.min(1, PHOTO_SIDE_MAX / Math.max(area.width, area.height)) : 1;
  return {
    width: Math.max(1, Math.round(area.width * scale)),
    height: Math.max(1, Math.round(area.height * scale)),
  };
}
