'use client';

/**
 * The box of a CSV import (O18, ruled 2026-10-14): a file is picked with the button OR
 * dropped on the page while the box is up. Only a `.csv` is taken, whichever way it came: another file is refused
 * with its name and the reason, and several dropped at once are refused. A refused file
 * leaves the file already picked as it was. Both CSV imports (an Event's roster, the super
 * admin's Global Profiles) use this box.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

type Refusal = { kind: 'not_csv'; name: string } | { kind: 'several' };

/** The file a pick or a drop gives, or why it is refused; null when nothing came. */
export function csvFileOf(files: ArrayLike<File> | null): File | Refusal | null {
  if (!files || files.length === 0) return null;
  if (files.length > 1) return { kind: 'several' };
  const file = files[0]!;
  return file.name.toLowerCase().endsWith('.csv') ? file : { kind: 'not_csv', name: file.name };
}

/** The preview's line naming the file's columns this import does not read (O18). */
export function UnreadColumnsNote({ columns }: { columns: string[] }) {
  const { t } = useI18n();
  if (columns.length === 0) return null;
  return (
    <p
      role="note"
      className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
    >
      {t('organizer.personsImport.unknownColumns', { columns: columns.join(', ') })}
    </p>
  );
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

/**
 * A file dropped anywhere on the page goes to `onFiles` while the caller is mounted (ruled
 * 2026-10-15): it used to open in the tab, and the page was lost. Both listeners are needed:
 * without the drag-over's, the browser never lets the drop happen, and without the drop's, it
 * opens the file. A drag of text is left alone, so it still drops into a field.
 */
function usePageFileDrop(onFiles: (files: FileList) => void) {
  // The window's listeners read the latest `onFiles`: it closes over the caller's render.
  const onFilesNow = useRef(onFiles);
  useEffect(() => {
    onFilesNow.current = onFiles;
  });
  useEffect(() => {
    const carriesFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const over = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      onFilesNow.current(e.dataTransfer!.files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
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

  usePageFileDrop(take);

  return (
    <div
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
