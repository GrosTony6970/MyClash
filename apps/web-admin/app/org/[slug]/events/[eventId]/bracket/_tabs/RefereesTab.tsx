'use client';

/**
 * RefereesTab — bracket-detail edition. R5 of the Staffing overhaul.
 *
 * Mirrors the pool-detail Referees tab (../../pools/_tabs/RefereesTab.tsx)
 * but filters to bracket + finals "pools" (the synthetic single-match
 * entries the backend produces in R4 for each bracket match).
 *
 * Sub-sections per bracket round — so the operator can scan the medal
 * set separately from the rest of the bracket. Each shows the same
 * per-match slot cards + the shared SwapSuggestionsPanel.
 *
 * The board itself — fetch, catalogues, assign/unassign/swap — lives in the
 * shared `useAssignmentBoard` hook; this file is the bracket-specific grouping
 * and nothing else.
 */

import { useEffect, useMemo, useState } from 'react';
import { t } from '@myclash/i18n';
import { useI18n } from '@myclash/next-i18n/client';
import { SwapSuggestionsPanel } from '../../referees/_components/SwapSuggestionsPanel';
import { CandidatePicker } from '../../referees/_components/CandidatePicker';
import { formatHHMM } from '../../referees/_components/format-hhmm';
import {
  useAssignmentBoard,
  type AssignmentBoardPool,
  type AssignmentBoardRoleSlot,
} from '../../referees/_components/useAssignmentBoard';
import { assignmentChipClasses } from '../../referees/_components/assignment-chip-classes';
import { groupBracketPoolsBySection } from './group-bracket-by-section';

interface Props {
  eventId: string;
  tournamentId: string;
  isReadOnly: boolean;
}

export function RefereesTab({ eventId, tournamentId, isReadOnly }: Props) {
  const {
    board,
    allBoardPools,
    loading,
    busy,
    error,
    skillNameById,
    skillColorById,
    manualAssign,
    unassign,
    applySwap,
  } = useAssignmentBoard(eventId, {
    loadFailed: t('organizer.bracketPage.refereesLoadFailed'),
    mutationFailed: t('organizer.bracketPage.refereesAssignFailed'),
  });
  const [picker, setPicker] = useState<{
    pool: AssignmentBoardPool;
    slot: AssignmentBoardRoleSlot;
  } | null>(null);
  /** Slice 4: local override of the parent's tournamentId — the in-view
   *  tab strip switches between tournaments without forcing the operator
   *  back up to the page-level dropdown. Defaults to the prop. */
  const [activeTournamentId, setActiveTournamentId] = useState<string>(tournamentId);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local override when the tournamentId prop changes
    setActiveTournamentId(tournamentId);
  }, [tournamentId]);

  /** Distinct tournaments that have at least one bracket / finals row.
   *  Drives the tab strip — only rendered when there's more than one. */
  const bracketTournaments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of allBoardPools) {
      if (p.kind !== 'bracket' && p.kind !== 'finals') continue;
      if (!seen.has(p.tournamentId)) seen.set(p.tournamentId, p.tournamentName || p.tournamentId);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [allBoardPools]);

  /**
   * Bracket-kind units for the active tournament. A POSITIVE filter, which is
   * what keeps pool and Swiss units — which share this payload — out of here
   * rather than relying on them not existing.
   */
  const bracketPools = useMemo(
    () =>
      allBoardPools.filter(
        (p) =>
          p.tournamentId === activeTournamentId && (p.kind === 'bracket' || p.kind === 'finals'),
      ),
    [allBoardPools, activeTournamentId],
  );

  // Group every bracket + finals match of the active tournament into round
  // sections (Play-ins → Round of 16 → … → Final), ordered play-ins first.
  const sections = useMemo(() => groupBracketPoolsBySection(bracketPools), [bracketPools]);

  if (loading && !board) {
    return <p className="text-sm text-muted">{t('organizer.bracketPage.refereesLoading')}</p>;
  }
  if (!board || bracketPools.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted">{t('organizer.bracketPage.refereesEmpty')}</p>
      </div>
    );
  }

  const filteredSwapSuggestions = (board.swapSuggestions ?? []).filter((s) =>
    bracketPools.some((p) => p.id === s.fromPoolId),
  );

  return (
    <section className="space-y-6">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {bracketTournaments.length > 1 && (
        <nav
          aria-label={t('organizer.bracketPage.refereesTournamentTabsLabel')}
          className="flex flex-wrap gap-2 border-b border-border"
        >
          {bracketTournaments.map((bt) => {
            const active = bt.id === activeTournamentId;
            return (
              <button
                key={bt.id}
                type="button"
                onClick={() => setActiveTournamentId(bt.id)}
                className={[
                  '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted hover:border-border hover:text-foreground-secondary',
                ].join(' ')}
              >
                {bt.name}
              </button>
            );
          })}
        </nav>
      )}

      {sections.map((section) => (
        <BracketMatchSection
          key={section.label}
          title={section.label}
          pools={section.pools}
          isReadOnly={isReadOnly || board.locked}
          busy={busy}
          skillNameById={skillNameById}
          skillColorById={skillColorById}
          onAssignClick={(pool, slot) => setPicker({ pool, slot })}
          onUnassign={(id) => void unassign(id)}
        />
      ))}

      <SwapSuggestionsPanel
        suggestions={filteredSwapSuggestions}
        isReadOnly={isReadOnly || board.locked}
        busy={busy}
        onApply={(s) => void applySwap(s)}
      />

      {picker && (
        <CandidatePicker
          pool={picker.pool}
          slot={picker.slot}
          onAssign={(userId) => {
            void manualAssign(picker.pool.id, picker.slot.role, userId).then((ok) => {
              if (ok) setPicker(null);
            });
          }}
          onCancel={() => setPicker(null)}
        />
      )}
    </section>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function BracketMatchSection({
  title,
  pools,
  isReadOnly,
  busy,
  skillNameById,
  skillColorById,
  onAssignClick,
  onUnassign,
}: {
  title: string;
  pools: AssignmentBoardPool[];
  isReadOnly: boolean;
  busy: boolean;
  skillNameById: Map<string, string>;
  skillColorById: Map<string, string>;
  onAssignClick: (pool: AssignmentBoardPool, slot: AssignmentBoardRoleSlot) => void;
  onUnassign: (assignmentId: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {pools.map((pool) => (
        <BracketMatchCard
          key={pool.id}
          pool={pool}
          isReadOnly={isReadOnly}
          busy={busy}
          skillNameById={skillNameById}
          skillColorById={skillColorById}
          onAssignClick={(slot) => onAssignClick(pool, slot)}
          onUnassign={onUnassign}
        />
      ))}
    </section>
  );
}

function BracketMatchCard({
  pool,
  isReadOnly,
  busy,
  skillNameById,
  skillColorById,
  onAssignClick,
  onUnassign,
}: {
  pool: AssignmentBoardPool;
  isReadOnly: boolean;
  busy: boolean;
  skillNameById: Map<string, string>;
  skillColorById: Map<string, string>;
  onAssignClick: (slot: AssignmentBoardRoleSlot) => void;
  onUnassign: (assignmentId: string) => void;
}) {
  const { locale } = useI18n();
  // Unified match code. The server now returns pool.name in the
  // canonical LSW-B-QF-M1 / LSW-B-PI-M5 shape via formatRoundCode,
  // so this surface no longer needs its own "Quarter-final #2"
  // re-formatter — the code matches what the bracket page, scoring
  // app, and exports already show.
  const roundLabel = pool.name;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="font-semibold text-foreground">
          {pool.tournamentName ? `${pool.tournamentName} – ${roundLabel}` : roundLabel}
        </p>
        {pool.scheduledStart && (
          <p className="text-xs text-muted">{formatHHMM(pool.scheduledStart, locale)}</p>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pool.roleSlots.map((slot) => (
          <div
            key={`${slot.slotIndex}:${slot.role}`}
            className={[
              'rounded-md border px-3 py-2',
              assignmentChipClasses({
                hasAssignment: !!slot.assignment,
                isError: slot.missingReasons.length > 0 && !slot.assignment,
                skillColor: skillColorById.get(slot.role) ?? null,
              }),
            ].join(' ')}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
              {slot.displayName ?? skillNameById.get(slot.role) ?? slot.role}
            </p>
            {slot.assignment ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{slot.assignment.displayName}</p>
                <button
                  type="button"
                  disabled={isReadOnly || busy}
                  onClick={() => onUnassign(slot.assignment!.id)}
                  className="text-xs text-danger hover:text-danger-hover disabled:opacity-50"
                >
                  {t('organizer.bracketPage.refereesUnassign')}
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-sm text-muted">
                  {t('organizer.bracketPage.refereesUnassigned')}
                </p>
                <button
                  type="button"
                  disabled={isReadOnly || busy}
                  onClick={() => onAssignClick(slot)}
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-background disabled:opacity-50"
                >
                  {t('organizer.bracketPage.refereesAssign')}
                </button>
              </div>
            )}
            {slot.missingReasons.length > 0 && !slot.assignment && (
              <p className="mt-1 text-[10px] text-danger">{slot.missingReasons.join(', ')}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
