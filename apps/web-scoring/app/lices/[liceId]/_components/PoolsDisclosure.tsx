'use client';

import { useState } from 'react';
import { CollapsibleSection } from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { useLazyFetch } from '../../../../src/hooks/useLazyFetch';
import {
  buildLicePoolSummaries,
  type LicePoolSummary,
} from '../../../../src/components/lice-pool-focus';
import type {
  PoolStandingsPayload,
  PoolWithMatches,
  StandingsColumn,
  StandingsRow,
} from '../../../../src/components/tournament-context-types';
import { ContextStatus } from './ContextStatus';
import { PoolMatchList } from './PoolMatchList';
import { PoolStandingsTable } from './PoolStandingsTable';

/** One pool: how much of it is ours, its standings, and its full match grid. */
function PoolCard({
  summary,
  pool,
  liceId,
  columns,
  rows,
}: {
  summary: LicePoolSummary;
  pool: PoolWithMatches | undefined;
  liceId: string;
  columns: StandingsColumn[] | undefined;
  rows: StandingsRow[] | undefined;
}) {
  const { t } = useI18n();
  return (
    <section
      className={`rounded-xl border bg-surface p-3 ${
        summary.anyOnThisLice ? 'border-accent' : 'border-border'
      }`}
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">{summary.poolName}</h3>
        <p className="text-xs text-muted">
          {t('scoring.lice.poolMatchesOnLice', {
            onLice: summary.onThisLice.length,
            total: summary.total,
          })}
        </p>
      </header>
      {columns && rows && <PoolStandingsTable columns={columns} rows={rows} />}
      {pool && <PoolMatchList matches={pool.matches} liceId={liceId} />}
    </section>
  );
}

/**
 * Every pool of a tournament running on this piste, with this lice's matches
 * called out — "display them all, focus on the lice".
 *
 * Both reads fire on first expand and never on the 20s match poll.
 */
export function PoolsDisclosure({
  apiUrl,
  liceId,
  tournamentId,
}: {
  apiUrl: string;
  liceId: string;
  tournamentId: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const pools = useLazyFetch<PoolWithMatches[]>(
    `${apiUrl}/api/v1/staff/lices/${liceId}/tournaments/${tournamentId}/pools`,
    open,
  );
  // Standings stay on the public route: it is anonymous by design, so wrapping
  // it in a staff-scoped sibling would buy nothing.
  const standings = useLazyFetch<PoolStandingsPayload>(
    `${apiUrl}/api/v1/tournaments/${tournamentId}/pool-standings?mode=by-pool`,
    open,
  );

  const poolRows = pools.data ?? [];
  const summaries = buildLicePoolSummaries(poolRows, liceId);
  const standingsByPool = new Map((standings.data?.pools ?? []).map((p) => [p.poolId, p]));

  return (
    <CollapsibleSection
      open={open}
      onToggle={() => setOpen((v) => !v)}
      headerClassName="min-h-[44px] w-full rounded-xl border border-border bg-surface px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted hover:border-muted"
      bodyClassName="mt-2 flex flex-col gap-3"
      header={t('scoring.lice.poolsSection')}
    >
      <ContextStatus
        loading={pools.loading}
        error={pools.error || standings.error}
        empty={poolRows.length === 0}
        emptyLabel={t('scoring.lice.poolsEmpty')}
        onRetry={() => {
          pools.reload();
          standings.reload();
        }}
      />
      {summaries.map((summary) => (
        <PoolCard
          key={summary.poolId}
          summary={summary}
          pool={poolRows.find((p) => p.poolId === summary.poolId)}
          liceId={liceId}
          columns={standings.data?.columns}
          rows={standingsByPool.get(summary.poolId)?.rows}
        />
      ))}
    </CollapsibleSection>
  );
}
