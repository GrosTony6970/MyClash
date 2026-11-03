'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { failureMessage } from '@myclash/api-client';
import { formatBytes } from '@/lib/format-bytes';
import { uploadInChunks, type UploadOutcome, type UploadProgress } from './chunked-upload';
import { backupRefusal, refusalOf } from './restore-words';
import {
  backupUploadTransport,
  browserClock,
  cancelBackupUpload,
  fileFingerprint,
} from './upload-transport';

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface BackupUploadHandlers {
  t: Translate;
  /** The night's whole set, once the file is kept (ruling 213: it replaces that night's row). */
  onStaged: (backup: unknown) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}

/** One file the operator sent: a run may stop and start again before it ends. */
interface Upload {
  file: File;
  /** The server's id, once a run has one: what a run started again follows, and Cancel removes. */
  uploadId: string | null;
  /** Answers the operator's start: whether the file was kept. Called once, by what ends it. */
  done: (kept: boolean) => void;
}

/** One run in flight: Cancel aborts it and removes what the server has. */
interface Running {
  controller: AbortController;
  upload: Upload;
}

interface Deps extends BackupUploadHandlers {
  apiUrl: string;
  /** The run in flight, or null: a stopped run's late answer is not read. */
  running: RefObject<Running | null>;
  setProgress: (progress: UploadProgress | null) => void;
}

/**
 * The backups screen's upload (`chunked-upload.ts` with the browser's transport): its progress,
 * its start and its Cancel. Leaving the page stops it; the server keeps what it received, and
 * the same file picked again resumes it (ruling 219), or the 24 h sweep removes it.
 *
 * React may also clean the screen up and set it up again while it stays (Strict Mode as the page
 * wakes up, a hidden `<Activity>` shown again). The cleanup stops the run; the setup starts it
 * again, and it follows the server's id of the upload from where the server is: the bytes still
 * missing, or the check (ruling 419). The screen keeps its bar meanwhile.
 */
export function useBackupUpload(apiUrl: string, handlers: BackupUploadHandlers) {
  const running = useRef<Running | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const deps: Deps = { ...handlers, apiUrl, running, setProgress };
  // The setup below starts a run with the handlers of the latest render, not the first one.
  const resume = useEffectEvent((upload: Upload) => void startUpload(upload, deps));

  const stopped = useRef<Upload | null>(null);
  useEffect(() => {
    const upload = stopped.current;
    stopped.current = null;
    if (upload) resume(upload);
    return () => {
      const run = running.current;
      if (!run) return;
      running.current = null;
      run.controller.abort();
      stopped.current = run.upload;
    };
  }, []);

  return {
    progress,
    /** @returns whether the file was kept. */
    start: (file: File) =>
      new Promise<boolean>((done) => void startUpload({ file, uploadId: null, done }, deps)),
    cancel: () => cancelUpload(deps),
  };
}

async function startUpload(upload: Upload, deps: Deps): Promise<void> {
  const { running, setProgress, onError, onNotice, t } = deps;
  const { file } = upload;
  onError(null);
  onNotice(null);
  const run: Running = { controller: new AbortController(), upload };
  running.current = run;
  // A run started again keeps the bar it had until the server says where the upload is.
  if (upload.uploadId === null)
    setProgress({ phase: 'sending', sentBytes: 0, totalBytes: file.size });
  let fingerprint: string;
  try {
    // A run that follows a known upload sends no start, so it reads nothing of the file here.
    fingerprint = upload.uploadId === null ? await fileFingerprint(file) : '';
  } catch {
    // The file could not be read (changed since it was picked): nothing is sent. A run
    // cancelled meanwhile has answered the start, and a stopped one hands it to the next run.
    if (running.current !== run) return;
    running.current = null;
    setProgress(null);
    onError(t('admin.backups.uploadUnreadable'));
    upload.done(false);
    return;
  }
  const outcome = await uploadInChunks(
    file,
    { filename: file.name, fingerprint },
    backupUploadTransport(deps.apiUrl, run.controller.signal),
    {
      clock: browserClock,
      signal: run.controller.signal,
      onProgress: (next) => {
        if (running.current === run) setProgress(next);
      },
      onStart: (uploadId) => {
        if (running.current === run) upload.uploadId = uploadId;
      },
      uploadId: upload.uploadId ?? undefined,
    },
  );
  settle(run, outcome, deps);
}

function settle(run: Running, outcome: UploadOutcome, deps: Deps): void {
  const { running, setProgress, onError, onNotice, onStaged, t } = deps;
  // A cancelled run has already said so, and a stopped one starts again: its late answer is
  // not read.
  if (running.current !== run) return;
  running.current = null;
  setProgress(null);
  if (outcome.ok) {
    onStaged(outcome.session.backup);
    onNotice(t('admin.backups.uploadStaged'));
    run.upload.done(true);
    return;
  }
  const fallback = t('admin.backups.uploadError');
  onError(
    backupRefusal(refusalOf(outcome.failure), t, formatBytes) ??
      failureMessage(outcome.failure, t, fallback) ??
      fallback,
  );
  run.upload.done(false);
}

/** Cancel says what the server confirmed: a removal it did not answer is not claimed. */
async function cancelUpload(deps: Deps): Promise<void> {
  const run = deps.running.current;
  if (!run) return;
  deps.running.current = null;
  run.controller.abort();
  run.upload.done(false);
  deps.setProgress(null);
  const { uploadId } = run.upload;
  const removed = uploadId ? (await cancelBackupUpload(deps.apiUrl, uploadId)).ok : false;
  deps.onNotice(
    deps.t(removed ? 'admin.backups.uploadCancelled' : 'admin.backups.uploadCancelUnconfirmed'),
  );
}
