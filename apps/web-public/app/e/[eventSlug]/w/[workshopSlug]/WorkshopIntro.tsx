'use client';

// What the public Workshop page says before its sessions (slice 3.6): the picture, the title and
// who teaches it, the tags, the description, what to know or bring, and about each instructor.

import { Avatar, TournamentColorDot } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { Instructor, Workshop } from './workshop-view';

const TAG = 'text-xs px-2 py-0.5 rounded-full';
const HEADING = 'text-xs font-semibold uppercase tracking-wider mb-3';
const TEXT = 'whitespace-pre-line text-sm leading-relaxed text-foreground-secondary';

export function WorkshopIntro({ workshop }: { workshop: Workshop }) {
  const description = workshop.descriptionMd ?? workshop.shortDescription;
  return (
    <>
      <IntroTitle workshop={workshop} />
      <IntroTags workshop={workshop} />
      {description && <div className={`prose prose-sm mb-6 max-w-none ${TEXT}`}>{description}</div>}
      <Prerequisites text={workshop.prerequisites} />
      <InstructorCards instructors={workshop.instructors} />
    </>
  );
}

function IntroTitle({ workshop }: { workshop: Workshop }) {
  const names = workshop.instructors.map((i) => i.displayName);
  return (
    <div className="mb-3 flex items-center gap-3">
      {workshop.coverImageUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={workshop.coverImageUrl}
          alt=""
          className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
        />
      )}
      <div className="min-w-0">
        <h1
          className="mb-1 flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl"
          style={{ color: 'var(--color-accent)' }}
        >
          <TournamentColorDot color={workshop.color} size="md" />
          {workshop.title}
        </h1>
        {names.length > 0 && <p className="text-muted text-sm">{names.join(', ')}</p>}
      </div>
    </div>
  );
}

function IntroTags({ workshop }: { workshop: Workshop }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {workshop.category && (
        <span className={`${TAG} bg-border text-foreground-secondary`}>{workshop.category}</span>
      )}
      {workshop.weapon && (
        <span className={`${TAG} bg-border text-foreground-secondary`}>{workshop.weapon}</span>
      )}
      {workshop.level && <span className={`${TAG} bg-info/10 text-info`}>{workshop.level}</span>}
      {workshop.language && (
        <span className={`${TAG} bg-border text-muted`}>{workshop.language.toUpperCase()}</span>
      )}
      {workshop.durationMinutes != null && (
        <span className={`${TAG} bg-border text-muted`}>
          {t('publicApp.workshops.durationMinutes', { count: workshop.durationMinutes })}
        </span>
      )}
    </div>
  );
}

function Prerequisites({ text }: { text: string | null }) {
  const { t } = useI18n();
  if (!text) return null;
  return (
    <section className="mb-6">
      <h2 className={HEADING} style={{ color: 'var(--color-accent)' }}>
        {t('publicApp.workshopDetail.prerequisites')}
      </h2>
      <p className={TEXT}>{text}</p>
    </section>
  );
}

const saysSomething = (i: Instructor) =>
  Boolean(i.about && (i.about.bio || i.about.club || i.about.photoUrl));

/** One card per instructor, once the page has something to say about any of them. */
function InstructorCards({ instructors }: { instructors: Instructor[] }) {
  const { t } = useI18n();
  if (!instructors.some(saysSomething)) return null;
  return (
    <section className="mb-6">
      <h2 className={HEADING} style={{ color: 'var(--color-accent)' }}>
        {t('publicApp.workshopDetail.instructorsHeading')}
      </h2>
      <ul className="flex flex-col gap-4">
        {instructors.map((i) => (
          <InstructorCard key={i.globalPersonId ?? i.displayName} instructor={i} />
        ))}
      </ul>
    </section>
  );
}

function InstructorCard({ instructor }: { instructor: Instructor }) {
  const about = instructor.about;
  return (
    <li className="flex gap-3">
      <Avatar name={instructor.displayName} src={about?.photoUrl ?? undefined} size="md" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{instructor.displayName}</p>
        {about?.club && <p className="text-xs text-muted">{about.club}</p>}
        {about?.bio && <p className={`mt-1 ${TEXT}`}>{about.bio}</p>}
      </div>
    </li>
  );
}
