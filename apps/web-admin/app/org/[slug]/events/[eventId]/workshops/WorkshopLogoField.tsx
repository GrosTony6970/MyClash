'use client';

/**
 * WorkshopLogoField — logo control for the workshop create/edit modal.
 *
 * Unlike EventLogoCard (immediate-upload — the event already exists),
 * this control STAGES the cropped PNG. The workshop may not exist yet
 * (create path), so the parent modal POSTs the staged blob to
 * `/workshops/:id/logo` after the create/patch resolves the id —
 * mirroring how the same form defers session + instructor writes.
 *
 * Reuses `validateLogoFile` (bumped to a 15 MB cap) and the shared
 * square `LogoCropperModal` (its zoom slider + Fit is the requested
 * "zoom in / zoom out").
 */

import { useRef, useState } from 'react';
import { validateLogoFile } from '../../../../../../src/lib/validate-logo-file';
import { LogoCropperModal } from '../../../_components/LogoCropperModal';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

interface Props {
  /** Currently-saved logo URL (edit mode), or null. */
  existingUrl: string | null;
  /** Staged (not-yet-uploaded) preview object URL, or null. */
  previewUrl: string | null;
  /** Source-file size cap (bytes). */
  maxBytes: number;
  disabled?: boolean;
  /** Baked square PNG blob + a fresh object URL the parent shows as preview. */
  onStage: (blob: Blob, previewUrl: string) => void;
  /** Operator cleared the logo (drops a staged pick or removes an existing one). */
  onClear: () => void;
}

export function WorkshopLogoField({
  existingUrl,
  previewUrl,
  maxBytes,
  disabled = false,
  onStage,
  onClear,
}: Props) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const shownUrl = previewUrl ?? existingUrl;

  function openPicker() {
    if (disabled) return;
    setError(null);
    fileInput.current?.click();
  }

  function handleFile(file: File) {
    const check = validateLogoFile(file, maxBytes);
    if (!check.ok) {
      setError(
        check.errorKey === 'organizer.events.logoTooLarge'
          ? t('organizer.workshopsPage.logoField.logoTooLarge')
          : t('organizer.workshopsPage.logoField.logoTypeInvalid'),
      );
      return;
    }
    setError(null);
    setPendingFile(file);
  }

  return (
    <div>
      <label className="block text-xs font-medium text-foreground-secondary mb-1">
        {t('organizer.workshopsPage.logoField.label')}
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          aria-label={
            shownUrl
              ? t('organizer.workshopsPage.logoField.replaceAria')
              : t('organizer.workshopsPage.logoField.uploadAria')
          }
          title={
            shownUrl
              ? t('organizer.workshopsPage.logoField.replaceAria')
              : t('organizer.workshopsPage.logoField.uploadAria')
          }
          className={[
            'group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-border bg-background',
            disabled
              ? 'cursor-not-allowed opacity-70'
              : 'cursor-pointer hover:border-muted hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent',
          ].join(' ')}
        >
          {shownUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={shownUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-wider text-muted">
              {t('organizer.workshopsPage.logoField.placeholder')}
            </div>
          )}
          {!disabled && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-strong/0 text-[10px] font-semibold uppercase tracking-wide text-strong-foreground opacity-0 transition-all group-hover:bg-strong/55 group-hover:opacity-100">
              {shownUrl
                ? t('organizer.workshopsPage.logoField.replace')
                : t('organizer.workshopsPage.logoField.upload')}
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{t('organizer.workshopsPage.logoField.hint')}</p>
          {shownUrl && !disabled && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                onClear();
              }}
              className="mt-1 text-xs font-medium text-danger hover:underline"
            >
              {t('organizer.workshopsPage.logoField.remove')}
            </button>
          )}
          {error && (
            <p className="mt-1 text-xs font-medium text-danger" role="alert">
              {error}
            </p>
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
          onSave={(blob) => {
            setPendingFile(null);
            onStage(blob, URL.createObjectURL(blob));
          }}
        />
      )}
    </div>
  );
}
