'use client';

import { useCallback, useState } from 'react';
import Cropper, { type Area, type Point } from 'react-easy-crop';
import { Button, Modal } from '@myclash/ui';

/**
 * Load an image element from an object/data URL. `crossOrigin` is set so the
 * canvas isn't tainted (object URLs are same-origin anyway, but this keeps the
 * helper safe if a remote URL is ever passed).
 */
function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (event) => reject(event));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });
}

/**
 * Draw the selected crop region onto a square canvas and export a compact JPEG.
 * Output is capped at `outputSize` px so the uploaded avatar stays small
 * regardless of the source resolution.
 */
export async function getCroppedBlob(
  imageSrc: string,
  crop: Area,
  outputSize = 512,
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-2d-unavailable');

  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, outputSize, outputSize);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas-toBlob-failed'))),
      'image/jpeg',
      0.9,
    );
  });
}

interface AvatarCropperProps {
  imageSrc: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/**
 * Modal cropper: round 1:1 framing with zoom + drag-to-reposition. On save it
 * hands a cropped square JPEG blob to the parent, which performs the upload.
 * Built on the shared @myclash/ui Modal (focus-trap + Escape + a11y chrome).
 */
export function AvatarCropper({ imageSrc, busy, onCancel, onSave, t }: AvatarCropperProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
    onSave(blob);
  };

  return (
    <Modal
      open
      onClose={onCancel}
      busy={busy}
      size="md"
      title={t('publicApp.fighterProfile.photoCropTitle')}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {t('publicApp.fighterProfile.photoCropCancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            loading={busy}
            disabled={busy || !croppedAreaPixels}
          >
            {t('publicApp.fighterProfile.photoCropSave')}
          </Button>
        </>
      }
    >
      <div className="relative h-72 w-full overflow-hidden rounded-lg bg-black">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <label className="mt-4 block text-sm">
        <span className="text-foreground-secondary">{t('publicApp.fighterProfile.photoZoom')}</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          aria-label={t('publicApp.fighterProfile.photoZoom')}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="mt-1 w-full accent-accent"
        />
      </label>
    </Modal>
  );
}
