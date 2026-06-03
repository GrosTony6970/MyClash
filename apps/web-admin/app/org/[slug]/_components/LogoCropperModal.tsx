'use client';

/* eslint-disable myclash/no-literal-string */

import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { useI18n } from '../../../../src/i18n/I18nProvider';

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

  // Read the picked File once. The object URL is revoked when the
  // modal closes so we don't leak between consecutive uploads.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && !saving) onCancel();
      }}
    >
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl">
        <header>
          <h2 className="text-lg font-bold text-slate-900">
            {t('organizer.dashboard.brand.cropper.title')}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {t('organizer.dashboard.brand.cropper.instructions')}
          </p>
        </header>

        <div className="relative h-80 w-full overflow-hidden rounded-lg bg-slate-900">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="contain"
            />
          )}
        </div>

        <label className="grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t('organizer.dashboard.brand.cropper.zoomLabel')}
          </span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(ev) => setZoom(Number(ev.target.value))}
            disabled={saving}
            className="w-full"
            aria-label={t('organizer.dashboard.brand.cropper.zoomLabel')}
          />
        </label>

        <footer className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {t('organizer.dashboard.brand.cropper.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !croppedAreaPixels}
            className="rounded-md bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
