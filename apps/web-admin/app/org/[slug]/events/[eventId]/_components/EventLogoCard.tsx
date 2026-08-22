'use client';

/**
 * EventLogoCard — clickable variant of the dashboard's logo summary
 * card. Clicking the thumbnail opens the file picker, validates the
 * selection via `validateLogoFile`, POSTs to /events/:id/logo, then
 * calls `onUploaded` so the parent can refresh its dashboard state.
 *
 * Immediate-upload semantics match the events-list per-row Upload
 * button and the tournament wizard's logo control. There's no Save
 * button on the dashboard, so staging would have nowhere to commit
 * from.
 */

import { useRef, useState } from 'react';
import { apiRequest, failureDetail } from '@myclash/api-client';
import { validateLogoFile } from '../../../../../../src/lib/validate-logo-file';
import { LogoCropperModal } from '../../../_components/LogoCropperModal';

interface Props {
  apiUrl: string;
  eventId: string;
  label: string;
  logoUrl: string | null;
  name: string;
  emptyLabel: string;
  /** Hover/empty-state copy, e.g. "Click to upload" / "Click to replace". */
  uploadHint: string;
  replaceHint: string;
  uploadingLabel: string;
  tooLargeLabel: string;
  wrongTypeLabel: string;
  failedLabel: string;
  /** Re-fetch the parent's event/stats data after a successful upload. */
  onUploaded: () => void | Promise<void>;
  /** Disable interaction (e.g. event is archived / read-only). */
  disabled?: boolean;
}

export function EventLogoCard({
  apiUrl,
  eventId,
  label,
  logoUrl,
  name,
  emptyLabel,
  uploadHint,
  replaceHint,
  uploadingLabel,
  tooLargeLabel,
  wrongTypeLabel,
  failedLabel,
  onUploaded,
  disabled = false,
}: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Picked file awaiting crop. The shared LogoCropperModal bakes it to a
  // square PNG (with zoom-out / Fit) before we upload.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  function openPicker() {
    if (disabled || uploading) return;
    setError(null);
    fileInput.current?.click();
  }

  // Validate up front so a bad file doesn't open the cropper, then stage it
  // for the crop modal instead of uploading the raw file directly.
  function handleFile(file: File) {
    const check = validateLogoFile(file);
    if (!check.ok) {
      setError(check.errorKey === 'organizer.events.logoTooLarge' ? tooLargeLabel : wrongTypeLabel);
      return;
    }
    setError(null);
    setPendingFile(file);
  }

  async function uploadCropped(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiRequest(apiUrl, `/api/v1/events/${eventId}/logo`, {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) {
        // `failureDetail` and not `failureMessage`: this card takes its copy as
        // props and has no translator of its own, so it renders the server's
        // sentence or the localized label the parent handed it.
        setError(failureDetail(r) ?? failedLabel);
        return;
      }
      await onUploaded();
    } finally {
      setUploading(false);
    }
  }

  const clickable = !disabled && !uploading;
  const hint = logoUrl ? replaceHint : uploadHint;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={openPicker}
          disabled={!clickable}
          aria-label={hint}
          title={hint}
          className={[
            'group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-border bg-background',
            clickable
              ? 'cursor-pointer hover:border-muted hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent'
              : 'cursor-not-allowed opacity-70',
          ].join(' ')}
        >
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-semibold uppercase tracking-wider text-muted">
              {name.slice(0, 2)}
            </div>
          )}
          {clickable && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-strong/0 text-[10px] font-semibold uppercase tracking-wide text-strong-foreground opacity-0 transition-all group-hover:bg-strong/55 group-hover:opacity-100">
              {uploading ? uploadingLabel : hint}
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
          <p className="mt-1 truncate text-sm text-muted">{logoUrl ? name : emptyLabel}</p>
          {error && (
            <p className="mt-1 text-xs font-medium text-danger" role="alert">
              {error}
            </p>
          )}
          {uploading && !error && (
            <p className="mt-1 text-xs font-medium text-muted">{uploadingLabel}</p>
          )}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {pendingFile && (
        <LogoCropperModal
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onSave={async (blob) => {
            setPendingFile(null);
            await uploadCropped(new File([blob], 'logo.png', { type: 'image/png' }));
          }}
        />
      )}
    </div>
  );
}
