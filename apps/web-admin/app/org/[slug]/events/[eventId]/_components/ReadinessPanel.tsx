'use client';

import Link from 'next/link';
import { statusPillTone } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import {
  isOutstanding,
  readinessFixHref,
  readinessLabelKey,
  readinessMessageKey,
  readinessSemantic,
  type ReadinessCheck,
  type ReadinessLevel,
  type ReadinessReport,
} from '../readiness-copy';

interface Props {
  report: ReadinessReport | null;
  error: string | null;
  slug: string;
  eventId: string;
}

/**
 * The pre-flight checklist for an event: what still stands between it and
 * running, grouped event-level first and then per tournament.
 *
 * Rows are shown at every level, cleared ones included. A checklist that hides
 * what passed cannot be read as "I have checked everything" — the green rows
 * are the reassurance, and their absence would leave the organiser wondering
 * whether the check ran at all.
 */
export function ReadinessPanel({ report, error, slug, eventId }: Props) {
  if (error) {
    return (
      <section className="mb-8 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
        {error}
      </section>
    );
  }
  if (!report) return null;

  return (
    <section className="mb-8 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <PanelHeader report={report} />
      <ReadinessGroups report={report} slug={slug} eventId={eventId} />
    </section>
  );
}

function PanelHeader({ report }: { report: ReadinessReport }) {
  const { t } = useI18n();
  const outstanding = report.checks.filter(isOutstanding).length;
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.readiness.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {outstanding === 0
            ? t('organizer.readiness.allClear')
            : t('organizer.readiness.outstanding', { count: outstanding })}
        </p>
      </div>
      <ReadinessChip level={report.worst} />
    </div>
  );
}

/** Event-level rows first, then one group per tournament that has any. */
function ReadinessGroups({
  report,
  slug,
  eventId,
}: {
  report: ReadinessReport;
  slug: string;
  eventId: string;
}) {
  const { t } = useI18n();
  const groups: Array<{ id: string; title: string; checks: ReadinessCheck[] }> = [
    {
      id: 'event',
      title: t('organizer.readiness.eventLevel'),
      checks: report.checks.filter((check) => check.tournamentId === null),
    },
    ...report.tournaments.map((tournament) => ({
      id: tournament.id,
      title: tournament.name,
      checks: report.checks.filter((check) => check.tournamentId === tournament.id),
    })),
  ];

  return (
    <>
      {groups
        .filter((group) => group.checks.length > 0)
        .map((group) => (
          <ReadinessGroup
            key={group.id}
            title={group.title}
            checks={group.checks}
            slug={slug}
            eventId={eventId}
          />
        ))}
    </>
  );
}

/** The roll-up chip, driven by the worst level anywhere in the checklist. */
export function ReadinessChip({ level }: { level: ReadinessLevel }) {
  const { t } = useI18n();
  return (
    <span
      className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
        statusPillTone(readinessSemantic(level), 'light').className
      }`}
    >
      {t(`organizer.readiness.level.${level}`)}
    </span>
  );
}

function ReadinessGroup({
  title,
  checks,
  slug,
  eventId,
}: {
  title: string;
  checks: ReadinessCheck[];
  slug: string;
  eventId: string;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
        {title}
      </h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {checks.map((check) => (
          <ReadinessRow
            key={`${check.tournamentId ?? 'event'}-${check.key}`}
            check={check}
            slug={slug}
            eventId={eventId}
          />
        ))}
      </ul>
    </div>
  );
}

function ReadinessRow({
  check,
  slug,
  eventId,
}: {
  check: ReadinessCheck;
  slug: string;
  eventId: string;
}) {
  const { t } = useI18n();
  const href = readinessFixHref(check, slug, eventId);
  const message = t(readinessMessageKey(check), check.values ?? {});

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <LevelDot level={check.level} />
      <span className="font-medium text-foreground">{t(readinessLabelKey(check))}</span>
      <span className="min-w-0 flex-1 text-muted">{message}</span>
      {href && (
        <Link
          href={href}
          className="flex-shrink-0 text-xs font-semibold text-accent hover:underline"
        >
          {isOutstanding(check) ? t('organizer.readiness.fix') : t('organizer.readiness.view')}
        </Link>
      )}
    </li>
  );
}

/**
 * Level is carried by an aria-labelled dot rather than colour alone — the
 * message text says what is wrong, but the severity would otherwise be
 * available only to people who can tell amber from red.
 */
function LevelDot({ level }: { level: ReadinessLevel }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border ${
        statusPillTone(readinessSemantic(level), 'light').className
      }`}
      role="img"
      aria-label={t(`organizer.readiness.level.${level}`)}
    />
  );
}
