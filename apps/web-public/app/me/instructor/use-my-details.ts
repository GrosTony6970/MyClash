'use client';

import { useEffect, useState } from 'react';
import { apiRequest, type ApiResult } from '@myclash/api-client';
import { changedText } from './changed-text';

/** A bio, a club line and a photo: what a Workshop or a profile says about an instructor. */
export interface Details {
  bio: string | null;
  club: string | null;
  photoUrl: string | null;
}

/** The instructor's own line: this Workshop's words over their profile, the boxes' hint (563). */
export interface DetailsView {
  override: Details;
  profile: Details;
}

export type Boxes = { bio: string; club: string };

const boxesOf = (details: Details): Boxes => ({
  bio: details.bio ?? '',
  club: details.club ?? '',
});

/**
 * The boxes after a landed save: a box sent keeps what was typed; a box not sent shows what is
 * stored now, since the organiser may have written it meanwhile.
 */
function afterSave(stored: Details, sent: object, draft: Boxes): Boxes {
  const next = boxesOf(stored);
  for (const key of Object.keys(sent) as (keyof Boxes)[]) next[key] = draft[key];
  return next;
}

/** What failed last, as the name of the line the panel says. */
export type DetailsError = 'myDetailsLoadError' | 'saveError' | 'myPhotoError' | 'myPhotoInvalid';

/** The line as the panel opened it: the view, the boxes typed in, and what they held then. */
function useMyRead(apiUrl: string, path: string, setError: (error: DetailsError | null) => void) {
  const [view, setView] = useState<DetailsView | null>(null);
  const [draft, setDraft] = useState<Boxes>({ bio: '', club: '' });
  const [loaded, setLoaded] = useState<Boxes>({ bio: '', club: '' });
  /** The boxes as stored: what they show, and what a later save compares against. */
  const settle = (boxes: Boxes) => {
    setDraft(boxes);
    setLoaded(boxes);
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      const read = await apiRequest<DetailsView>(apiUrl, path);
      if (!live) return;
      if (!read.ok) {
        setError('myDetailsLoadError');
        return;
      }
      setView(read.data);
      setDraft(boxesOf(read.data.override));
      setLoaded(boxesOf(read.data.override));
    })();
    return () => {
      live = false;
    };
  }, [apiUrl, path, setError]);

  return { view, setView, draft, setDraft, loaded, settle };
}

/** One write at a time: busy while it runs, what failed last kept for the panel to say. */
function useMyWrite() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DetailsError | null>(null);

  /** What the server answered, or null after saying it failed. */
  async function write<T>(send: () => Promise<ApiResult<T>>, failure: DetailsError) {
    setBusy(true);
    setError(null);
    const answer = await send();
    setBusy(false);
    if (answer.ok) return answer.data;
    setError(failure);
    return null;
  }

  return { busy, error, setError, write };
}

/**
 * Reads and writes the instructor's own line on a Workshop (2.6b, ruling 558). The organiser
 * writes it too: a Save sends only the boxes changed since the panel opened, and every box
 * settles on what is stored after each landed save. A photo is stored at once.
 */
export function useMyDetails(apiUrl: string, path: string) {
  const { busy, error, setError, write } = useMyWrite();
  const { view, setView, draft, setDraft, loaded, settle } = useMyRead(apiUrl, path, setError);

  async function save() {
    if (!view) return;
    const sent = { ...changedText('bio', draft, loaded), ...changedText('club', draft, loaded) };
    if (Object.keys(sent).length === 0) return;
    const stored = await write(
      () => apiRequest<Details>(apiUrl, path, { method: 'PATCH', body: sent }),
      'saveError',
    );
    if (!stored) return;
    settle(afterSave(stored, sent, draft));
    setView({ ...view, override: stored });
  }

  async function uploadPhoto(blob: Blob) {
    if (!view) return;
    const body = new FormData();
    body.append('file', blob, 'photo.jpg');
    const stored = await write(
      () => apiRequest<{ url: string }>(apiUrl, `${path}/photo`, { method: 'POST', body }),
      'myPhotoError',
    );
    if (stored) setView({ ...view, override: { ...view.override, photoUrl: stored.url } });
  }

  async function removePhoto() {
    if (!view) return;
    const stored = await write(
      () => apiRequest<{ url: null }>(apiUrl, `${path}/photo`, { method: 'DELETE' }),
      'myPhotoError',
    );
    if (stored) setView({ ...view, override: { ...view.override, photoUrl: null } });
  }

  return {
    view,
    draft,
    setBox: (key: keyof Boxes, value: string) => setDraft((d) => ({ ...d, [key]: value })),
    busy,
    error,
    setError,
    save,
    uploadPhoto,
    removePhoto,
  };
}
