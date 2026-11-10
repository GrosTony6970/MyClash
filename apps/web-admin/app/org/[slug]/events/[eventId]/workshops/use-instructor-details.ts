'use client';

import { useEffect, useState } from 'react';
import { apiRequest, type ApiFailure, type ApiResult } from '@myclash/api-client';
import { changedBoxes } from './WorkshopTextFields';

/** A bio, a club line and a photo: what a Workshop or a profile says about an instructor. */
export interface InstructorDetails {
  bio: string | null;
  club: string | null;
  photoUrl: string | null;
}

/** One instructor line: this Workshop's own words over the profile, the empty boxes' hint (563). */
export interface InstructorDetailsView {
  override: InstructorDetails;
  profile: InstructorDetails;
}

export type DetailBoxes = { bio: string; club: string };

const BOXES = ['bio', 'club'] as const;
const boxesOf = (details: InstructorDetails): DetailBoxes => ({
  bio: details.bio ?? '',
  club: details.club ?? '',
});

/** The line as the panel opened it: the view, the boxes typed in, and what they held then. */
function useDetailsRead(apiUrl: string, path: string) {
  const [view, setView] = useState<InstructorDetailsView | null>(null);
  const [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [boxes, setBoxes] = useState<DetailBoxes>({ bio: '', club: '' });
  const [asLoaded, setAsLoaded] = useState<DetailBoxes>({ bio: '', club: '' });

  useEffect(() => {
    let live = true;
    void (async () => {
      const read = await apiRequest<InstructorDetailsView>(apiUrl, path);
      if (!live) return;
      if (!read.ok) {
        setLoadFailure(read);
        return;
      }
      setView(read.data);
      setBoxes(boxesOf(read.data.override));
      setAsLoaded(boxesOf(read.data.override));
    })();
    return () => {
      live = false;
    };
  }, [apiUrl, path]);

  return { view, setView, loadFailure, boxes, setBoxes, asLoaded, setAsLoaded };
}

/** One write at a time: busy while it runs, its refusal kept for the panel to say. */
function useWrite() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  /** What the server answered, or null when it refused. */
  async function write<T>(send: () => Promise<ApiResult<T>>): Promise<T | null> {
    setBusy(true);
    setFailure(null);
    const answer = await send();
    setBusy(false);
    if (answer.ok) return answer.data;
    setFailure(answer);
    return null;
  }

  return { busy, failure, write };
}

/**
 * Reads and writes one instructor line's details (2.6b). Two people write them (558): the
 * organiser here, the instructor from their own page. A Save sends only the boxes changed since
 * the panel opened, and the baseline moves after each landed save. A photo is stored at once.
 */
export function useInstructorDetails(apiUrl: string, path: string) {
  const { view, setView, loadFailure, boxes, setBoxes, asLoaded, setAsLoaded } = useDetailsRead(
    apiUrl,
    path,
  );
  const { busy, failure, write } = useWrite();
  const stored = (override: InstructorDetails) =>
    setView((current) => current && { ...current, override });

  async function save(): Promise<boolean> {
    if (!view) return false;
    const sent = changedBoxes(BOXES, boxes, asLoaded);
    if (Object.keys(sent).length === 0) return true;
    const saved = await write(() =>
      apiRequest<InstructorDetails>(apiUrl, path, { method: 'PATCH', body: sent }),
    );
    if (!saved) return false;
    setAsLoaded(boxes);
    stored(saved);
    return true;
  }

  async function uploadPhoto(blob: Blob) {
    if (!view) return;
    const form = new FormData();
    form.append('file', new File([blob], 'photo.png', { type: blob.type || 'image/png' }));
    const answer = await write(() =>
      apiRequest<{ url: string }>(apiUrl, `${path}/photo`, { method: 'POST', body: form }),
    );
    if (answer) stored({ ...view.override, photoUrl: answer.url });
  }

  async function removePhoto() {
    if (!view) return;
    const answer = await write(() => apiRequest(apiUrl, `${path}/photo`, { method: 'DELETE' }));
    if (answer !== null) stored({ ...view.override, photoUrl: null });
  }

  return {
    view,
    loadFailure,
    boxes,
    setBox: (key: keyof DetailBoxes, value: string) => setBoxes((b) => ({ ...b, [key]: value })),
    busy,
    failure,
    save,
    uploadPhoto,
    removePhoto,
  };
}
