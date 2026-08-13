'use client';

import { useState } from 'react';
import { CollapsibleSection } from '@myclash/ui';
import type { TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { useLazyFetch } from '../../../../src/hooks/useLazyFetch';
import {
  buildLicePoolSummaries,
  orderLicePoolSummaries,
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
import { RefereeChipLine } from './RefereeChipLine';

/**
 * The pool's name, its piste(s), how much of it is ours, and who referees it.
 *
 * Phrasing content only — this is rendered inside `CollapsibleSection`'s
 * `<button>`, whose content model admits nothing else.
 */
function PoolCardHeader({ summary }: { summary: LicePoolSummary }) {
  const { t } = useI18n();
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-bold text-foreground">{summary.poolName}</span>
        {summary.liceNames.length > 0 && (
          // Rendered RAW and unprefixed: the organiser's default naming already
          // produces "Lice 4", so a "Lice {name}" template reads "Lice Lice 4".
          <span className="text-xs font-semibold text-foreground-secondary">
            {summary.liceNames.join(' · ')}
          </span>
        )}
        <span className="text-xs font-normal text-muted">
          {t('scoring.lice.poolMatchesOnLice', {
            onLice: summary.onThisLice.length,
            total: summary.total,
          })}
        </span>
      </span>
      {summary.referees.length > 0 && (
        <span className="block text-left">
          <span className="sr-only">{t('scoring.lice.poolReferees')}</span>
          <RefereeChipLine referees={summary.referees} inline />
        </span>
      )}
    </span>
  );
}

/** One pool: how much of it is ours, its standings, and its full match grid. */
function PoolCard({
  summary,
  pool,
  liceId,
  columns,
  rows,
  scoringConfig,
}: {
  summary: LicePoolSummary;
  pool: PoolWithMatches | undefined;
  liceId: string;
  columns: StandingsColumn[] | undefined;
  rows: StandingsRow[] | undefined;
  scoringConfig: TournamentScoringConfig | null;
}) {
  // Seeded once, from whether the pool touches this piste: expanding "Pools"
  // opens the operator's own pool and leaves the other three folded, which is
  // the whole point of folding them individually. Caller-owned state, so a
  // later poll cannot slam a pool the operator just opened shut again.
  const [open, setOpen] = useState(() => summary.anyOnThisLice);

  return (
    <section
      className={`rounded-xl border bg-surface ${
        summary.anyOnThisLice ? 'border-accent' : 'border-border'
      }`}
    >
      <CollapsibleSection
        open={open}
        onToggle={() => setOpen((v) => !v)}
        headerClassName="min-h-[44px] px-3 py-2 text-left hover:bg-background"
        bodyClassName="px-3 pb-3"
        header={<PoolCardHeader summary={summary} />}
      >
        {columns && rows && <PoolStandingsTable columns={columns} rows={rows} />}
        {pool && (
          <PoolMatchList matches={pool.matches} liceId={liceId} scoringConfig={scoringConfig} />
        )}
      </CollapsibleSection>
    </section>
  );
}

/**
 * Every pool of a tournament running on this piste, with this lice's own pools
 * first and open — "display them all, focus on the lice".
 *
 * Both reads fire on first expand and never on the 20s match poll.
 */
export function PoolsDisclosure({
  apiUrl,
  liceId,
  tournamentId,
  scoringConfig,
}: {
  apiUrl: string;
  liceId: string;
  tournamentId: string;
  scoringConfig: TournamentScoringConfig | null;
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
  const summaries = orderLicePoolSummaries(buildLicePoolSummaries(poolRows, liceId));
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
          scoringConfig={scoringConfig}
        />
      ))}
    </CollapsibleSection>
  );
}
