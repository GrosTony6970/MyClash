'use client';

import { useEffect, useRef, useState } from 'react';
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

/** One upload in flight: Cancel aborts it and removes what the server has. */
interface Running {
  controller: AbortController;
  uploadId: string | null;
}

interface Deps extends BackupUploadHandlers {
  apiUrl: string;
  /** The upload in flight, or null: a cancelled run's late answer is not read. */
  running: RefObject<Running | null>;
  setProgress: (progress: UploadProgress | null) => void;
}

/**
 * The backups screen's upload (`chunked-upload.ts` with the browser's transport): its progress,
 * its start and its Cancel. Leaving the page stops it; the server keeps what it received, and
 * the same file picked again resumes it (ruling 219), or the 24 h sweep removes it.
 */
export function useBackupUpload(apiUrl: string, handlers: BackupUploadHandlers) {
  const running = useRef<Running | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    const flight = running;
    return () => flight.current?.controller.abort();
  }, []);

  const deps: Deps = { ...handlers, apiUrl, running, setProgress };
  return {
    progress,
    /** @returns whether the file was kept. */
    start: (file: File) => startUpload(file, deps),
    cancel: () => cancelUpload(deps),
  };
}

async function startUpload(file: File, deps: Deps): Promise<boolean> {
  const { running, setProgress, onError, onNotice, t } = deps;
  onError(null);
  onNotice(null);
  const run: Running = { controller: new AbortController(), uploadId: null };
  running.current = run;
  setProgress({ phase: 'sending', sentBytes: 0, totalBytes: file.size });
  let fingerprint: string;
  try {
    fingerprint = await fileFingerprint(file);
  } catch {
    // The file could not be read (changed since it was picked): nothing is sent. A run
    // cancelled meanwhile has already said so.
    if (running.current !== run) return false;
    running.current = null;
    setProgress(null);
    onError(t('admin.backups.uploadUnreadable'));
    return false;
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
        run.uploadId = uploadId;
      },
    },
  );
  return settle(run, outcome, deps);
}

function settle(run: Running, outcome: UploadOutcome, deps: Deps): boolean {
  const { running, setProgress, onError, onNotice, onStaged, t } = deps;
  // A cancelled run has already said so; its late answer is not read.
  if (running.current !== run) return false;
  running.current = null;
  setProgress(null);
  if (outcome.ok) {
    onStaged(outcome.session.backup);
    onNotice(t('admin.backups.uploadStaged'));
    return true;
  }
  const fallback = t('admin.backups.uploadError');
  onError(
    backupRefusal(refusalOf(outcome.failure), t, formatBytes) ??
      failureMessage(outcome.failure, t, fallback) ??
      fallback,
  );
  return false;
}

/** Cancel says what the server confirmed: a removal it did not answer is not claimed. */
async function cancelUpload(deps: Deps): Promise<void> {
  const run = deps.running.current;
  if (!run) return;
  deps.running.current = null;
  run.controller.abort();
  deps.setProgress(null);
  const removed = run.uploadId ? (await cancelBackupUpload(deps.apiUrl, run.uploadId)).ok : false;
  deps.onNotice(
    deps.t(removed ? 'admin.backups.uploadCancelled' : 'admin.backups.uploadCancelUnconfirmed'),
  );
}
