'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { computeMinZoom, type Size } from './logo-cropper-zoom';

interface Props {
  /** File freshly picked from the operator's file picker. */
  file: File;
  onCancel: () => void;
  /** Receives the baked PNG blob; caller is responsible for the upload. */
  onSave: (croppedBlob: Blob) => void | Promise<void>;
}

/**
 * Drag + zoom logo cropper. Renders a fixed 1:1 crop overlay so the
 * baked output is always square — matches the 128×128 canvas on the
 * org branding card with no letterboxing or stretching downstream.
 *
 * The cropper is purely client-side: on **Save** we render the
 * picked area to an offscreen canvas at the image's natural pixel
 * size, then `canvas.toBlob` into PNG and hand the blob back to the
 * caller. The existing `POST /organizations/:id/logo` endpoint
 * doesn't change.
 */
export function LogoCropperModal({ file, onCancel, onSave }: Props) {
  const { t } = useI18n();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  // Auto-fit: react-easy-crop reports the rendered media + crop sizes; the
  // smallest zoom at which the whole logo fits the square is derived from
  // them so wide/tall logos can be shown in full (with white margins).
  const [mediaSize, setMediaSize] = useState<Size | null>(null);
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const minZoom = useMemo(() => computeMinZoom(mediaSize, cropSize), [mediaSize, cropSize]);

  // Read the picked File once. The object URL is revoked when the
  // modal closes so we don't leak between consecutive uploads.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync of an external resource (object URL) into state, paired with the revoke teardown below
    setImageSrc(url);
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [file]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  async function handleSave() {
    if (!imageSrc || !croppedAreaPixels) return;
    setSaving(true);
    try {
      const blob = await cropImageToBlob(imageSrc, croppedAreaPixels);
      if (!blob) return;
      await onSave(blob);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('organizer.dashboard.brand.cropper.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && !saving) onCancel();
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape' && !saving) onCancel();
      }}
    >
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl bg-surface p-5 shadow-xl">
        <header>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('organizer.dashboard.brand.cropper.title')}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t('organizer.dashboard.brand.cropper.instructions')}
          </p>
        </header>

        <div className="relative h-80 w-full overflow-hidden rounded-lg bg-strong">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              minZoom={minZoom}
              maxZoom={4}
              restrictPosition={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              onMediaLoaded={(m) => setMediaSize({ width: m.width, height: m.height })}
              onCropSizeChange={(s) => setCropSize({ width: s.width, height: s.height })}
              objectFit="contain"
            />
          )}
        </div>

        <div className="grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.dashboard.brand.cropper.zoomLabel')}
          </span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={minZoom}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(ev) => setZoom(Number(ev.target.value))}
              disabled={saving}
              className="w-full flex-1"
              aria-label={t('organizer.dashboard.brand.cropper.zoomLabel')}
            />
            <button
              type="button"
              onClick={() => {
                setZoom(minZoom);
                setCrop({ x: 0, y: 0 });
              }}
              disabled={saving}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {t('organizer.dashboard.brand.cropper.fit')}
            </button>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {t('organizer.dashboard.brand.cropper.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !croppedAreaPixels}
            className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? t('organizer.dashboard.brand.cropper.saving')
              : t('organizer.dashboard.brand.cropper.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Render `imageSrc` cropped to `pixelArea` into a PNG blob at the
 * source's natural pixel size. Used by the modal on **Save** to
 * bake the crop client-side before uploading.
 */
async function cropImageToBlob(imageSrc: string, pixelArea: Area): Promise<Blob | null> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(pixelArea.width));
  canvas.height = Math.max(1, Math.round(pixelArea.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Fill with white before drawImage so transparent source pixels
  // (common for brand assets supplied as transparent PNGs) become
  // visible white pixels in the output. The org-logo surfaces (light
  // sidebar, white card backgrounds, light list rows) would otherwise
  // show the slate-50 container straight through, which the operator
  // reads as "blank square" — even though the IMG is in the DOM and
  // the bytes loaded successfully.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    image,
    pixelArea.x,
    pixelArea.y,
    pixelArea.width,
    pixelArea.height,
    0,
    0,
    pixelArea.width,
    pixelArea.height,
  );
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png', 0.92);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = (err) => reject(err);
    image.src = src;
  });
}
