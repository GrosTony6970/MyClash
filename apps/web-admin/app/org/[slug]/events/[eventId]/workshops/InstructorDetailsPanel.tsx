'use client';

/**
 * What one Workshop says about one of its instructors, over their profile (rulings 556, 558-560,
 * 563, 564): a bio, a club line and a photo. Opened from the instructor's name in the Workshop's
 * form, once the instructor is saved on it. An empty box shows the profile's value in grey: the
 * profile shows there. A private profile bio is never the organiser's hint.
 */
import { useRef, useState } from 'react';
import { Button, FormField, Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { failureMessage } from '@myclash/api-client';
import { WORKSHOP_INSTRUCTOR_BIO_MAX, WORKSHOP_INSTRUCTOR_CLUB_MAX } from '@myclash/types';
import { validateLogoFile } from '../../../../../../src/lib/validate-logo-file';
import { LogoCropperModal } from '../../../_components/LogoCropperModal';
import { useInstructorDetails, type InstructorDetailsView } from './use-instructor-details';

/** The photo's cap, the server's (`WORKSHOP_INSTRUCTOR_PHOTO_UPLOAD`). */
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

interface Props {
  apiUrl: string;
  workshopId: string;
  instructor: { globalPersonId: string; displayName: string };
  onClose: () => void;
}

export function InstructorDetailsPanel({ apiUrl, workshopId, instructor, onClose }: Props) {
  const { t } = useI18n();
  const details = useInstructorDetails(
    apiUrl,
    `/api/v1/workshops/${workshopId}/instructors/${instructor.globalPersonId}/details`,
  );
  const message = details.failure
    ? failureMessage(details.failure, t, t('admin.common.saveFailed'))
    : details.loadFailure &&
      failureMessage(
        details.loadFailure,
        t,
        t('organizer.workshopsPage.instructorDetails.loadFailed'),
      );

  return (
    <Modal
      open
      onClose={onClose}
      busy={details.busy}
      size="md"
      title={t('organizer.workshopsPage.instructorDetails.title', {
        name: instructor.displayName,
      })}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('actions.close')}
          </Button>
          <Button
            disabled={!details.view || details.busy}
            onClick={() => void details.save().then((saved) => saved && onClose())}
          >
            {t('actions.save')}
          </Button>
        </div>
      }
    >
      {details.view ? (
        <DetailFields details={details} view={details.view} />
      ) : (
        !details.loadFailure && <p className="text-sm text-muted">{t('common.loading')}</p>
      )}
      {message && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {message}
        </p>
      )}
    </Modal>
  );
}

function DetailFields({
  details,
  view,
}: {
  details: ReturnType<typeof useInstructorDetails>;
  view: InstructorDetailsView;
}) {
  const { t } = useI18n();
  const hint = t('organizer.workshopsPage.instructorDetails.emptyHint');
  return (
    <div className="flex flex-col gap-4">
      <PhotoField details={details} view={view} />
      <FormField
        multiline
        rows={5}
        label={t('organizer.workshopsPage.instructorDetails.bioLabel')}
        hint={hint}
        value={details.boxes.bio}
        placeholder={view.profile.bio ?? ''}
        maxLength={WORKSHOP_INSTRUCTOR_BIO_MAX}
        onChange={(e) => details.setBox('bio', e.target.value)}
      />
      <FormField
        label={t('organizer.workshopsPage.instructorDetails.clubLabel')}
        hint={hint}
        value={details.boxes.club}
        placeholder={view.profile.club ?? ''}
        maxLength={WORKSHOP_INSTRUCTOR_CLUB_MAX}
        onChange={(e) => details.setBox('club', e.target.value)}
      />
    </div>
  );
}

function PhotoField({
  details,
  view,
}: {
  details: ReturnType<typeof useInstructorDetails>;
  view: InstructorDetailsView;
}) {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const own = view.override.photoUrl;
  const shown = own ?? view.profile.photoUrl;

  function pick(file: File) {
    if (!validateLogoFile(file, PHOTO_MAX_BYTES).ok) {
      setError(t('organizer.workshopsPage.instructorDetails.photoInvalid'));
      return;
    }
    setError(null);
    setPending(file);
  }

  return (
    <div className="flex items-center gap-3">
      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-border bg-background">
        {shown ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={shown}
            alt=""
            className={`h-full w-full object-cover ${own ? '' : 'opacity-50'}`}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <p className="text-xs text-muted">
          {own
            ? t('organizer.workshopsPage.instructorDetails.photoOwn')
            : t('organizer.workshopsPage.instructorDetails.photoFromProfile')}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={details.busy}
            onClick={() => picker.current?.click()}
          >
            {own
              ? t('organizer.workshopsPage.instructorDetails.photoReplace')
              : t('organizer.workshopsPage.instructorDetails.photoUpload')}
          </Button>
          {own && (
            <Button
              size="sm"
              variant="outline"
              disabled={details.busy}
              onClick={() => void details.removePhoto()}
            >
              {t('organizer.workshopsPage.instructorDetails.photoRemove')}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pick(file);
          e.target.value = '';
        }}
      />
      {pending && (
        <LogoCropperModal
          file={pending}
          onCancel={() => setPending(null)}
          onSave={async (blob) => {
            setPending(null);
            await details.uploadPhoto(blob);
          }}
        />
      )}
    </div>
  );
}
