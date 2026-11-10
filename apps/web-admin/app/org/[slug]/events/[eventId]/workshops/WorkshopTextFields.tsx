'use client';

/**
 * A Workshop's two short texts in its form (ruling 557): the line on its catalogue card, and what
 * a learner should know or bring. Both ride in the Workshop list, so the form fills them at once,
 * and a blank box clears the field on save.
 */
import { useI18n } from '@myclash/next-i18n/client';

/** The server's limits (`apps/api/src/modules/workshops/workshop-text.ts`). */
const SHORT_DESCRIPTION_MAX = 200;
const PREREQUISITES_MAX = 2000;

interface Texts {
  shortDescription: string;
  prerequisites: string;
}

/** What a save sends: trimmed, a blank box as null (clears it). */
export function formTexts(form: Texts): {
  shortDescription: string | null;
  prerequisites: string | null;
} {
  return {
    shortDescription: form.shortDescription.trim() || null,
    prerequisites: form.prerequisites.trim() || null,
  };
}

const FIELD =
  'w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

export function WorkshopTextFields({
  values,
  onChange,
}: {
  values: Texts;
  onChange: (texts: Partial<Texts>) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div>
        <label
          htmlFor="workshop-short-description"
          className="block text-xs font-medium text-foreground-secondary mb-1"
        >
          {t('organizer.workshopsPage.shortDescriptionLabel')}
        </label>
        <input
          id="workshop-short-description"
          value={values.shortDescription}
          maxLength={SHORT_DESCRIPTION_MAX}
          onChange={(e) => onChange({ shortDescription: e.target.value })}
          className={FIELD}
        />
        <p className="mt-1 text-xs text-muted">
          {t('organizer.workshopsPage.shortDescriptionHint')}
        </p>
      </div>
      <div>
        <label
          htmlFor="workshop-prerequisites"
          className="block text-xs font-medium text-foreground-secondary mb-1"
        >
          {t('organizer.workshopsPage.prerequisitesLabel')}
        </label>
        <textarea
          id="workshop-prerequisites"
          value={values.prerequisites}
          maxLength={PREREQUISITES_MAX}
          onChange={(e) => onChange({ prerequisites: e.target.value })}
          rows={2}
          className={`${FIELD} resize-none`}
        />
        <p className="mt-1 text-xs text-muted">{t('organizer.workshopsPage.prerequisitesHint')}</p>
      </div>
    </>
  );
}
