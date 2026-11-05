'use client';

import { useI18n } from '@myclash/next-i18n/client';

/** The Event's Tournaments and Workshops a photo can be about, as the public sees them. */
export interface PhotoTags {
  tournaments: Array<{ id: string; name: string }>;
  workshops: Array<{ id: string; title: string }>;
}

/**
 * The Tournament and Workshop options of a photo picker, valued `t:<id>` / `w:<id>` (`tagOf`): the
 * send page's tag and the photos page's filter. Each select owns its label and its first option.
 */
export function TagOptions({ tags }: { tags: PhotoTags }) {
  const { t } = useI18n();
  return (
    <>
      {tags.tournaments.length > 0 && (
        <optgroup label={t('publicApp.photoSend.tournaments')}>
          {tags.tournaments.map(({ id, name }) => (
            <option key={id} value={`t:${id}`}>
              {name}
            </option>
          ))}
        </optgroup>
      )}
      {tags.workshops.length > 0 && (
        <optgroup label={t('publicApp.photoSend.workshops')}>
          {tags.workshops.map(({ id, title }) => (
            <option key={id} value={`w:${id}`}>
              {title}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
