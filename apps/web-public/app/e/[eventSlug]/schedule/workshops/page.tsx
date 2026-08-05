/**
 * Public workshop schedule — the organizer's workshop board, read-only.
 *
 * A calendar grid (venue/area columns × time rows) on tablet and up; the
 * day-by-day agenda list below `md`, where 200px-wide room columns would mean
 * horizontal scrolling on a phone. The split is CSS, not a breakpoint hook, so
 * this page stays a server component and neither branch flashes on hydration.
 */

import type { Metadata } from 'next';
import { createTranslator, getMessages } from '@myclash/i18n';
import { getServerApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { EventHeader, fetchEventInfo } from '../../_components/EventHeader';
import { resolveServerLocale } from '@/i18n/server-locale';
import { fetchWorkshops } from '../../home/_lib/public-event-data';
import { buildWorkshopEntries } from '../../home/_lib/schedule-entries';
import { ScheduleAgenda } from '../../home/_components/ScheduleAgenda';
import { loadWorkshopSchedule } from './_lib/workshop-grid-data';
import { WorkshopScheduleGrid } from './_components/WorkshopScheduleGrid';
import { UnlistedWorkshops } from './_components/UnlistedWorkshops';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  // The event layout already applies a "%s — MyClash" title template.
  const tr = createTranslator(getMessages(await resolveServerLocale()));
  return { title: tr('publicApp.eventHome.schedule.viewWorkshopSchedule') };
}

export default async function WorkshopSchedulePage({ params }: Props) {
  const { eventSlug } = await params;
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const tr = createTranslator(getMessages(locale));
  const [event, workshops, schedule] = await Promise.all([
    fetchEventInfo(eventSlug, apiUrl),
    fetchWorkshops(eventSlug, apiUrl),
    loadWorkshopSchedule(eventSlug, apiUrl),
  ]);
  const entries = buildWorkshopEntries(workshops, eventSlug);
  const tz = event?.timezone ?? 'Europe/Paris';
  const emptyLabel = tr('publicApp.eventHome.schedule.notScheduled');

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={tr('publicApp.eventHome.backToHome')}
        className="mb-1"
      />
      {event && <EventHeader event={event} locale={locale} eventSlug={eventSlug} />}
      <section className="flex flex-col gap-6">
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {tr('publicApp.eventHome.schedule.viewWorkshopSchedule')}
        </h1>

        {schedule ? (
          <div className="hidden flex-col gap-6 md:flex">
            <WorkshopScheduleGrid data={schedule} emptyLabel={emptyLabel} />
            {/* Timed but in a room the grid has no column for — the agenda
                already lists these on mobile, so only the grid branch needs it. */}
            <UnlistedWorkshops
              heading={tr('publicApp.eventHome.schedule.venueTbc')}
              workshops={schedule.unplaced}
            />
          </div>
        ) : null}

        <div className="md:hidden">
          <ScheduleAgenda entries={entries} tz={tz} locale={locale} emptyLabel={emptyLabel} />
        </div>

        {/* Untimed workshops appear nowhere else on the site — both branches. */}
        {schedule ? <UnlistedWorkshops heading={emptyLabel} workshops={schedule.undated} /> : null}
      </section>
    </main>
  );
}
