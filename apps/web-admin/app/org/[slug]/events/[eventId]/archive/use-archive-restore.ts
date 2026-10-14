'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useI18n, type Translator } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { errorOutcome, successOutcome, type Outcome } from '@/components/PageAlert';
import { restoredNotice, type RestoreAnswer } from './restore-notice';
import { RESTORE_CONFIRMATION, type RestorePreview } from './RestorePreviewCard';

type Sent<T> = { ok: true; data: T } | { ok: false; message: string | null };

/** Posts the picked archive file; a refusal comes back in words (the server's, or `fallback`). */
async function postArchive<T>(path: string, file: File, t: Translator, fallback: string) {
  const body = new FormData();
  body.set('file', file);
  const r = await apiRequest<T>(getPublicApiUrl(), path, { method: 'POST', body });
  // The restore reader names the table or the version it choked on: the whole value
  // of a preview step, which "Could not read this archive." used to replace.
  return (r.ok ? r : { ok: false, message: failureMessage(r, t, t(fallback)) }) as Sent<T>;
}

/**
 * Where a restore goes: a whole Event into the club, one Tournament into this Event. It
 * carries the exact phrase, whatever the organiser typed (`restorePhraseTyped`).
 */
export function restorePath(
  scope: RestorePreview['scope'] | undefined,
  eventId: string,
  organizationId: string | undefined,
): string {
  const params = new URLSearchParams({ confirmation: RESTORE_CONFIRMATION });
  if (scope === 'event' && organizationId) params.set('targetOrganizationId', organizationId);
  if (scope === 'tournament') params.set('targetEventId', eventId);
  return `/api/v1/archive/restore?${params.toString()}`;
}

/**
 * The state of the restore form (O23): ONE picked file, and a preview of THAT file. A
 * file picked again, or a preview refused, leaves no preview and no phrase on screen.
 */
export function useArchiveRestore(eventId: string, organizationId: string | undefined) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function send<T>(path: string, fallback: string): Promise<T | null> {
    setOutcome(file ? null : errorOutcome(t('organizer.archive.uploadMissing')));
    if (!file) return null;
    setBusy(true);
    const sent = await postArchive<T>(path, file, t, fallback).finally(() => setBusy(false));
    if (!sent.ok && sent.message) setOutcome(errorOutcome(sent.message));
    return sent.ok ? sent.data : null;
  }

  const pickFile = (picked: File | null) => {
    setFile(picked);
    setPreview(null);
    setConfirmation('');
    setOutcome(null);
  };
  const previewRestore = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const path = '/api/v1/archive/restore-preview';
    void send<RestorePreview>(path, 'organizer.archive.previewError').then((read) => {
      setPreview(read);
      if (!read) setConfirmation('');
    });
  };
  const restoreArchive = () => {
    const path = restorePath(preview?.scope, eventId, organizationId);
    void send<RestoreAnswer>(path, 'organizer.archive.restoreError').then((answer) => {
      if (!answer) return;
      setOutcome(successOutcome(restoredNotice(t, answer)));
      setConfirmation('');
    });
  };
  const state = { preview, confirmation, busy, outcome };
  return { ...state, setConfirmation, pickFile, previewRestore, restoreArchive };
}
