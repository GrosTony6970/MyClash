import Link from 'next/link';

/**
 * The door from the Event home to a person's own day (quick win F7): "My
 * schedule", and "Find my name" for somebody the site does not know yet.
 *
 * The same card for every visitor (operator ruling, 2026-10-13). The home is
 * drawn on the server and does not know who holds the phone; the schedule page
 * does, and shows her bouts, the sign-in door or the roster.
 */
export function MyScheduleCard({
  eventSlug,
  tr,
}: {
  eventSlug: string;
  tr: (key: string) => string;
}) {
  return (
    <section
      aria-labelledby="my-schedule-card"
      className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-4 pl-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <span aria-hidden="true" className="absolute left-0 top-0 h-full w-1 bg-accent" />
      <h2 id="my-schedule-card" className="font-display text-base font-semibold text-foreground">
        {tr('publicApp.eventHome.mine.title')}
      </h2>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/e/${eventSlug}/my-schedule`}
          className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {tr('publicApp.eventHome.mine.schedule')}
        </Link>
        <Link
          href={`/e/${eventSlug}/participants`}
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground-secondary transition-colors hover:border-muted hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {tr('publicApp.eventHome.mine.findMe')}
        </Link>
      </div>
    </section>
  );
}
