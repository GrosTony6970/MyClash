'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { formatCountOfMax } from '../format-count-of-max';

/** The Event's Workshops as the overview's read counts them (API `workshop-totals.ts`). */
export interface WorkshopTotals {
  workshops: number;
  sessions: number;
  seatsTaken: number;
  seats: number | null;
  waitlisted: number;
}

export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      {detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}
    </div>
  );
}

/**
 * What a Workshops-only club sees in place of the fighter and referee cards (slice 2.7). A
 * cancelled session counts nowhere; with no seat total, "Seats taken" shows the number alone.
 */
export function WorkshopMetricCards({ totals }: { totals: WorkshopTotals | undefined }) {
  const { t } = useI18n();
  return (
    <>
      <MetricCard
        label={t('organizer.eventHub.dashboard.workshops')}
        value={String(totals?.workshops ?? 0)}
      />
      <MetricCard
        label={t('organizer.eventHub.dashboard.workshopSessions')}
        value={String(totals?.sessions ?? 0)}
      />
      <MetricCard
        label={t('organizer.eventHub.dashboard.seatsTaken')}
        value={formatCountOfMax(totals?.seatsTaken ?? 0, totals?.seats ?? null)}
      />
      <MetricCard
        label={t('organizer.eventHub.dashboard.workshopWaitlists')}
        value={String(totals?.waitlisted ?? 0)}
      />
    </>
  );
}
