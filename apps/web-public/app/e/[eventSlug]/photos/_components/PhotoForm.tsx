'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { PHOTO_CAPTION_MAX, PHOTO_NAME_MAX } from '@myclash/types';
import { tagOf } from '@/lib/photos/photo-tag';
import { PhotoQueue } from '../send/PhotoQueue';
import type { usePhotoQueue } from '../send/use-photo-queue';
import { PHOTO_FIELD_CLS } from './photo-field';
import { TagOptions, type PhotoTags } from './TagOptions';

/**
 * The photo form of the QR page and of the Photos tab of a personal space (slice 6b): the photos,
 * the optional fields, the notice line, Send. No `<form>`: nothing here can be submitted by the
 * browser itself, before React or by Enter in a field.
 */

export type PhotoQueueView = ReturnType<typeof usePhotoQueue>;

const LABEL_CLS = 'block text-sm font-medium text-foreground';

/** Why nothing can be sent from here, and a way on when the page has one. */
export function ClosedPanel({
  message,
  link,
}: {
  message: string;
  link: { href: string; label: string } | null;
}) {
  return (
    <div role="status" className="mt-6 rounded-lg border border-border bg-surface p-5">
      <p className="text-sm text-foreground">{message}</p>
      {link && (
        <Link
          href={link.href}
          className="mt-3 inline-block text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}

function OptionalLabel({ htmlFor, label }: { htmlFor: string; label: string }) {
  const { t } = useI18n();
  return (
    <label htmlFor={htmlFor} className={LABEL_CLS}>
      {label} <span className="font-normal text-muted">({t('publicApp.photoSend.optional')})</span>
    </label>
  );
}

function TagPicker(props: { tags: PhotoTags; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const { tournaments, workshops } = props.tags;
  if (tournaments.length === 0 && workshops.length === 0) return null;
  return (
    <div>
      <OptionalLabel htmlFor="photo-tag" label={t('publicApp.photoSend.tagLabel')} />
      <select
        id="photo-tag"
        className={PHOTO_FIELD_CLS}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">{t('publicApp.photoSend.tagNone')}</option>
        <TagOptions tags={props.tags} />
      </select>
    </div>
  );
}

function TextField(props: {
  id: string;
  label: string;
  max: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <OptionalLabel htmlFor={props.id} label={props.label} />
      <input
        id={props.id}
        type="text"
        className={PHOTO_FIELD_CLS}
        maxLength={props.max}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

/** "Take or choose photos": live only once the page is ready to send. */
function PickButton({ ready, onPick }: { ready: boolean; onPick: (files: File[]) => void }) {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    onPick(files);
  };
  return (
    <>
      <input
        ref={picker}
        type="file"
        accept="image/jpeg"
        multiple
        className="hidden"
        data-testid="photo-picker"
        onChange={picked}
      />
      <Button
        variant="outline"
        className="w-full"
        disabled={!ready}
        onClick={() => picker.current?.click()}
      >
        {t('publicApp.photoSend.pick')}
      </Button>
    </>
  );
}

/** Her name, when the photo carries it (a personal space: no name box, design Goal 11). */
function NameField({
  poster,
  value,
  onChange,
}: {
  poster: string | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  if (poster !== undefined) {
    return (
      <p className="text-sm text-foreground">
        {t('publicApp.myPhotos.postedAs', { name: poster })}
      </p>
    );
  }
  return (
    <TextField
      id="photo-name"
      label={t('publicApp.photoSend.nameLabel')}
      max={PHOTO_NAME_MAX}
      value={value}
      onChange={onChange}
    />
  );
}

/** The open form. With `poster`, the photo carries that name and the form asks for none. */
export function PhotoForm({
  queue,
  ready,
  tags,
  poster,
}: {
  queue: PhotoQueueView;
  ready: boolean;
  tags: PhotoTags;
  poster?: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [caption, setCaption] = useState('');
  const [tag, setTag] = useState('');
  const fields = { name: poster === undefined ? name : '', caption, tag: tagOf(tag) };
  const waiting = queue.items.some((item) => item.state === 'waiting');
  return (
    <div className="mt-6 space-y-4">
      <PickButton ready={ready} onPick={(files) => void queue.add(files)} />
      <PhotoQueue
        items={queue.items}
        onRetry={(key) => queue.retry(key, fields)}
        onRemove={queue.remove}
      />
      <NameField poster={poster} value={name} onChange={setName} />
      <TextField
        id="photo-caption"
        label={t('publicApp.photoSend.captionLabel')}
        max={PHOTO_CAPTION_MAX}
        value={caption}
        onChange={setCaption}
      />
      <TagPicker tags={tags} value={tag} onChange={setTag} />
      <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-foreground-secondary">
        {t('publicApp.photoSend.notice')}
      </p>
      <Button
        variant="primary"
        className="w-full"
        disabled={!ready || queue.running || !waiting}
        onClick={() => queue.send(fields)}
      >
        {t('publicApp.photoSend.send')}
      </Button>
    </div>
  );
}
