'use client';

/**
 * What one Workshop shows about the instructor, over their profile (rulings 556, 558-560, 563),
 * written by the instructor for their own line: a bio, a club line and a photo. An empty box shows
 * their profile's value in grey, a private bio included (it is theirs).
 */
import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import {
  WORKSHOP_INSTRUCTOR_BIO_MAX,
  WORKSHOP_INSTRUCTOR_CLUB_MAX,
  WORKSHOP_INSTRUCTOR_PHOTO_MAX_BYTES,
} from '@myclash/types';
import { AvatarCropper } from '../../profile/fighter/AvatarCropper';
import { useMyDetails, type DetailsError, type DetailsView } from './use-my-details';

/** The photo's types, the server's (`WORKSHOP_INSTRUCTOR_PHOTO_UPLOAD`). */
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const INPUT =
  'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';
const SMALL_BUTTON =
  'rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-background disabled:opacity-50';
const LABEL = 'mt-3 flex flex-col gap-1 text-xs font-semibold text-muted';

type MyDetails = ReturnType<typeof useMyDetails>;

export function MyDetailsPanel({
  workshopId,
  globalPersonId,
  apiUrl,
}: {
  workshopId: string;
  globalPersonId: string;
  apiUrl: string;
}) {
  const { t } = useI18n();
  const details = useMyDetails(
    apiUrl,
    `/api/v1/workshops/${workshopId}/instructors/${globalPersonId}/details`,
  );
  const view = details.view;

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs text-muted">{t('publicApp.me.instructor.myDetailsHint')}</p>
      {view && <MyPhoto details={details} view={view} />}
      {view && <MyBoxes details={details} view={view} />}
      {details.error && <ErrorLine error={details.error} />}
      {view && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={details.busy}
            onClick={() => void details.save()}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {t('publicApp.me.instructor.save')}
          </button>
        </div>
      )}
    </div>
  );
}

function MyBoxes({ details, view }: { details: MyDetails; view: DetailsView }) {
  const { t } = useI18n();
  return (
    <>
      <label className={LABEL}>
        {t('publicApp.me.instructor.myBioLabel')}
        <textarea
          rows={4}
          maxLength={WORKSHOP_INSTRUCTOR_BIO_MAX}
          className={`${INPUT} resize-none`}
          value={details.draft.bio}
          placeholder={view.profile.bio ?? ''}
          onChange={(e) => details.setBox('bio', e.target.value)}
        />
      </label>
      <label className={LABEL}>
        {t('publicApp.me.instructor.myClubLabel')}
        <input
          maxLength={WORKSHOP_INSTRUCTOR_CLUB_MAX}
          className={INPUT}
          value={details.draft.club}
          placeholder={view.profile.club ?? ''}
          onChange={(e) => details.setBox('club', e.target.value)}
        />
      </label>
    </>
  );
}

function ErrorLine({ error }: { error: DetailsError }) {
  const { t } = useI18n();
  const words: Record<DetailsError, string> = {
    myDetailsLoadError: t('publicApp.me.instructor.myDetailsLoadError'),
    saveError: t('publicApp.me.instructor.saveError'),
    myPhotoError: t('publicApp.me.instructor.myPhotoError'),
    myPhotoInvalid: t('publicApp.me.instructor.myPhotoInvalid'),
  };
  return (
    <p role="alert" className="mt-2 text-sm text-danger">
      {words[error]}
    </p>
  );
}

function MyPhoto({ details, view }: { details: MyDetails; view: DetailsView }) {
  const { t } = useI18n();
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const own = view.override.photoUrl;
  const shown = own ?? view.profile.photoUrl;

  function pick(file: File) {
    if (file.size > WORKSHOP_INSTRUCTOR_PHOTO_MAX_BYTES || !PHOTO_TYPES.includes(file.type)) {
      details.setError('myPhotoInvalid');
      return;
    }
    details.setError(null);
    setCropSrc(URL.createObjectURL(file));
  }

  function closeCropper() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full border border-border bg-surface">
        {shown && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={shown}
            alt=""
            className={`h-full w-full object-cover ${own ? '' : 'opacity-50'}`}
          />
        )}
      </div>
      <MyPhotoButtons own={Boolean(own)} details={details} onPick={pick} />
      {cropSrc && (
        <AvatarCropper
          imageSrc={cropSrc}
          busy={details.busy}
          onCancel={closeCropper}
          onSave={(blob) => {
            closeCropper();
            void details.uploadPhoto(blob);
          }}
          t={t}
        />
      )}
    </div>
  );
}

/** Upload (or Replace) picks a file; Remove shows only for this Workshop's own photo. */
function MyPhotoButtons({
  own,
  details,
  onPick,
}: {
  own: boolean;
  details: MyDetails;
  onPick: (file: File) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-xs text-muted">
        {own
          ? t('publicApp.me.instructor.myPhotoOwn')
          : t('publicApp.me.instructor.myPhotoFromProfile')}
      </p>
      <div className="flex gap-2">
        <label className={`${SMALL_BUTTON} cursor-pointer`}>
          {own
            ? t('publicApp.me.instructor.myPhotoReplace')
            : t('publicApp.me.instructor.myPhotoUpload')}
          <input
            type="file"
            accept={PHOTO_TYPES.join(',')}
            className="hidden"
            disabled={details.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onPick(file);
            }}
          />
        </label>
        {own && (
          <button
            type="button"
            disabled={details.busy}
            onClick={() => void details.removePhoto()}
            className={SMALL_BUTTON}
          >
            {t('publicApp.me.instructor.myPhotoRemove')}
          </button>
        )}
      </div>
    </div>
  );
}
