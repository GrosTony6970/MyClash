'use client';

/**
 * The box of a CSV import (O18, ruled 2026-10-14): a file is picked with the button OR
 * dropped on the box. Only a `.csv` is taken, whichever way it came: another file is refused
 * with its name and the reason, and several dropped at once are refused. A refused file
 * leaves the file already picked as it was. Both CSV imports (an Event's roster, the super
 * admin's Global Profiles) use this box.
 */
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

type Refusal = { kind: 'not_csv'; name: string } | { kind: 'several' };

/** The file a pick or a drop gives, or why it is refused; null when nothing came. */
export function csvFileOf(files: ArrayLike<File> | null): File | Refusal | null {
  if (!files || files.length === 0) return null;
  if (files.length > 1) return { kind: 'several' };
  const file = files[0]!;
  return file.name.toLowerCase().endsWith('.csv') ? file : { kind: 'not_csv', name: file.name };
}

/** "Choose CSV file": the hidden file input, opened by the button. */
function PickButton({
  inputTestId,
  onPick,
}: {
  inputTestId?: string;
  onPick: (files: FileList | null) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        data-testid={inputTestId}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => onPick(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
      >
        {t('organizer.personsImport.chooseFile')}
      </button>
    </>
  );
}

/** The picked file's name and size, or why the last one was refused. */
function PickStatus({ file, refusal }: { file: File | null; refusal: Refusal | null }) {
  const { t } = useI18n();
  return (
    <>
      {file && (
        <p className="text-sm text-foreground-secondary mt-2">
          {t('organizer.personsImport.selectedLabel')} <strong>{file.name}</strong>{' '}
          {t('organizer.personsImport.sizeKb', { size: (file.size / 1024).toFixed(1) })}
        </p>
      )}
      {refusal && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {refusal.kind === 'several'
            ? t('organizer.personsImport.oneFileAtATime')
            : t('organizer.personsImport.notCsv', { name: refusal.name })}
        </p>
      )}
    </>
  );
}

export function CsvDropZone({
  file,
  onFile,
  inputTestId,
  children,
}: {
  file: File | null;
  onFile: (file: File) => void;
  inputTestId?: string;
  /** What the box says above its button: the columns, a template link. */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function take(files: ArrayLike<File> | null) {
    const picked = csvFileOf(files);
    if (picked === null) return;
    setRefusal(picked instanceof File ? null : picked);
    if (picked instanceof File) onFile(picked);
  }

  // Both are needed: without the drag-over's, the browser never lets the drop happen, and
  // without the drop's, it opens the dropped file in place of the page.
  return (
    <div
      onDragOver={(e: DragEvent) => e.preventDefault()}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        take(e.dataTransfer.files);
      }}
      data-testid="csv-drop-zone"
      className="border-2 border-dashed border-border rounded-xl p-8 text-center"
    >
      {children}
      <PickButton inputTestId={inputTestId} onPick={take} />
      <p className="mt-2 text-xs text-muted">{t('organizer.personsImport.dropHint')}</p>
      <PickStatus file={file} refusal={refusal} />
    </div>
  );
}
