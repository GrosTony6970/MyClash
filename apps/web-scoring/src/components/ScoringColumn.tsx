'use client';

/**
 * ScoringColumn — per-side scoring column for the redesigned scoreboard.
 *
 * Renders, top-to-bottom for ONE fighter side:
 *   1. Big score numeral
 *   2. Fighter name
 *   3. Club (optional)
 *   4. Card-counter chips (one per ruleset card colour)
 *   5. CLEAN HIT section header + ruleset-driven clean buttons
 *   6. AFTERBLOW section header + ruleset-driven afterblow buttons
 *   7. PENALTIES section header + ruleset entry picker + direct cards
 *
 * The component is rendered TWICE in the new layout — once for `red`
 * on the left, once for `blue` on the right. The centre column
 * (timer, clock controls, Double, No exchange, events list) is a
 * separate ScoringCenterControls component between the two columns.
 *
 * All visual colour comes from `sideStyle()` against the tournament's
 * configured `scoringConfig.display.sideColors.{red,blue}` — never
 * hardcoded.
 */

import { useMemo, useState } from 'react';
import type { TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '../i18n/I18nProvider';
import { sideStyle } from '@myclash/ui';
import { usePenalties, type PenaltyCard, type PenaltyRulesetEntry } from '../hooks/usePenalties';
import type { ExchangeSide, UseScoringSubmitResult } from '../hooks/useScoringSubmit';

interface ScoringColumnProps {
  side: ExchangeSide;
  apiUrl: string;
  matchId: string;
  nextSequence: number;
  registrationId: string;
  fighterName: string;
  club?: string | null;
  score: number;
  config: TournamentScoringConfig;
  scoringEnabled: boolean;
  canScore: boolean;
  /** Match-clock position (accumulated active ms) — stamped on the
   *  penalty so the timeline shows match-clock time. */
  clockTimeMs: number | null;
  submit: UseScoringSubmitResult;
  onPenaltyRecorded?: () => void;
  /** Bump to force the per-side penalty hook to refetch. */
  penaltiesRefreshKey: number;
}

const CARD_CHIP_COLOR: Record<PenaltyCard, string> = {
  yellow: 'bg-yellow-500',
  red: 'bg-red-600',
  black: 'bg-gray-900 border border-gray-600',
};

const CARD_LABEL: Record<PenaltyCard, string> = {
  yellow: 'Yellow',
  red: 'Red',
  black: 'Black',
};

export function ScoringColumn({
  side,
  apiUrl,
  matchId,
  nextSequence,
  registrationId,
  fighterName,
  club,
  score,
  config,
  scoringEnabled,
  canScore,
  clockTimeMs,
  submit,
  onPenaltyRecorded,
  penaltiesRefreshKey,
}: ScoringColumnProps) {
  const { t } = useI18n();
  const style = sideStyle(config, side);
  const otherStyle = sideStyle(config, side === 'red' ? 'blue' : 'red');
  const visibleClean = config.buttons.clean.filter((b) => b.visible);
  const visibleAfterblows = config.buttons.afterblow.filter((b) => b.visible);
  const { ruleset, ruleSetCards, countFor } = usePenalties(apiUrl, matchId, penaltiesRefreshKey);

  const entries = useMemo(
    () =>
      [...(ruleset?.penalty_ruleset_entries ?? [])].sort(
        (a, b) => a.group_number - b.group_number || a.ref_number - b.ref_number,
      ),
    [ruleset],
  );

  const [penaltyQuery, setPenaltyQuery] = useState('');
  const [directReason, setDirectReason] = useState('');
  const [penaltyError, setPenaltyError] = useState<string | null>(null);
  const [penaltySubmitting, setPenaltySubmitting] = useState(false);
  const penaltyDisabled = !scoringEnabled || penaltySubmitting;

  const filteredEntries = useMemo(() => {
    const q = penaltyQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.short_name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        String(entry.ref_number).includes(q),
    );
  }, [entries, penaltyQuery]);

  async function submitPenalty(payload: {
    rulesetEntryId?: string;
    directCard?: PenaltyCard;
    reason?: string;
  }) {
    setPenaltySubmitting(true);
    setPenaltyError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clientUuid: crypto.randomUUID(),
          sequence: nextSequence,
          registrationId,
          occurredAt: new Date().toISOString(),
          clockTimeMs,
          ...payload,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to record penalty');
      }
      setDirectReason('');
      onPenaltyRecorded?.();
    } catch (err) {
      setPenaltyError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setPenaltySubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 px-2">
      {/* Score numeral */}
      <p
        className="text-center text-8xl font-black tabular-nums leading-none mt-2"
        style={{ color: style.border }}
      >
        {score}
      </p>

      {/* Fighter name + club */}
      <div className="text-center">
        <p className="text-3xl font-bold text-white leading-tight truncate">{fighterName}</p>
        {club && <p className="text-lg text-gray-400 mt-0.5 truncate">{club}</p>}
      </div>

      {/* Card-counter chips (ruleset-driven) */}
      <div className="flex justify-center gap-2">
        {ruleSetCards.map((card) => {
          const count = countFor(registrationId, card);
          return (
            <span
              key={card}
              title={t('scoring.lice.cardCounterTooltip', {
                card: CARD_LABEL[card],
                fighter: fighterName,
              })}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold transition-opacity ${CARD_CHIP_COLOR[card]} text-white ${
                count === 0 ? 'opacity-30' : ''
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-sm bg-white/70" />
              {count}
            </span>
          );
        })}
      </div>

      {/* CLEAN HIT */}
      {visibleClean.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
            {t('scoring.lice.cleanHitsHeader')}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {visibleClean.map((btn) => (
              <button
                key={btn.label}
                onClick={() => submit.submitClean(side, btn)}
                disabled={submit.submitting || !canScore}
                className="min-h-[56px] rounded-xl border-2 font-black text-xl disabled:opacity-40 transition-colors touch-manipulation"
                style={{
                  backgroundColor: style.panel,
                  borderColor: style.border,
                  color: style.text,
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AFTERBLOW */}
      {visibleAfterblows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
            {t('scoring.lice.afterblowHeader')}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {visibleAfterblows.map((btn) => (
              <button
                key={btn.label}
                onClick={() => submit.submitAfterblow(side, btn)}
                disabled={submit.submitting || !canScore}
                className="min-h-[48px] rounded-xl border-2 border-orange-700 bg-orange-950 text-orange-200 font-bold text-sm hover:bg-orange-900 active:bg-orange-800 disabled:opacity-40 transition-colors touch-manipulation"
                title={
                  config.afterblowMode === 'deductive'
                    ? t('scoring.pad.afterblowTitleDeductive', {
                        attacker: fighterName,
                        defender: '—',
                        attackerPts: btn.attackerPts,
                      })
                    : t('scoring.pad.afterblowTitleFull', {
                        attacker: fighterName,
                        defender: '—',
                        attackerPts: btn.attackerPts,
                        defenderPts: btn.defenderPts,
                      })
                }
              >
                {btn.label}
                <span className="block text-xs font-normal opacity-60">
                  {config.afterblowMode === 'deductive'
                    ? `+${btn.attackerPts} / 0`
                    : `+${btn.attackerPts} / +${btn.defenderPts}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* PENALTIES — inline picker. Extra top margin + a divider separate
          this clearly from the afterblow buttons above it. */}
      <div className="flex flex-col gap-2 mt-6 border-t border-gray-800 pt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
          {t('scoring.lice.penaltiesHeader')}
        </p>

        {penaltyError && (
          <p className="rounded-lg bg-red-900 px-3 py-2 text-xs text-red-100">{penaltyError}</p>
        )}

        <input
          value={penaltyQuery}
          onChange={(e) => setPenaltyQuery(e.target.value)}
          placeholder={t('scoring.lice.penaltySearch')}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-yellow-500"
        />

        <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
          {filteredEntries.length === 0 && (
            <p className="text-center text-xs text-gray-500 py-3">
              {t('scoring.lice.penaltiesNone')}
            </p>
          )}
          {filteredEntries.slice(0, 30).map((entry) => (
            <PenaltyEntryRow
              key={entry.id}
              entry={entry}
              groupLabel={t('scoring.penalties.group')}
              disabled={penaltyDisabled}
              onClick={() => void submitPenalty({ rulesetEntryId: entry.id })}
            />
          ))}
        </div>

        <div className="border-t border-gray-800 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
            {t('scoring.lice.directCardSection')}
          </p>
          <input
            value={directReason}
            onChange={(e) => setDirectReason(e.target.value)}
            placeholder={t('scoring.lice.directCardReason')}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-yellow-500 mb-2"
          />
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${ruleSetCards.length}, minmax(0, 1fr))` }}
          >
            {ruleSetCards.map((card) => (
              <button
                key={card}
                type="button"
                disabled={penaltyDisabled || directReason.trim().length === 0}
                onClick={() => void submitPenalty({ directCard: card, reason: directReason })}
                className={`rounded-lg border-2 px-2 py-2 text-xs font-black uppercase text-white disabled:opacity-40 ${CARD_CHIP_COLOR[card]}`}
              >
                {CARD_LABEL[card]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Silence unused warning — otherStyle reserved for cross-side UI hooks. */}
      <span className="hidden" aria-hidden style={{ color: otherStyle.muted }} />
    </div>
  );
}

function PenaltyEntryRow({
  entry,
  groupLabel,
  disabled,
  onClick,
}: {
  entry: PenaltyRulesetEntry;
  groupLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const card = entry.sanctions[0];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-left text-sm hover:border-yellow-600 disabled:opacity-40 flex items-center gap-2"
    >
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-gray-100">
          {entry.ref_number}. {entry.short_name}
        </span>
        <span className="block text-[10px] text-gray-500 truncate">
          <span className="mr-1.5 rounded bg-gray-800 px-1 py-0.5 font-semibold text-gray-400">
            {groupLabel} {entry.group_number}
          </span>
          {entry.description}
        </span>
      </div>
      {card && (
        <span className={`inline-block h-5 w-5 rounded ${CARD_CHIP_COLOR[card]} flex-shrink-0`} />
      )}
    </button>
  );
}
