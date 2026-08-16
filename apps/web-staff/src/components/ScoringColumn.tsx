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
import { computeAfterblowDeltas } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../theme/ThemeProvider';
import { outlineInkOn, sideStyle } from '@myclash/ui';
import { usePenalties, type PenaltyCard, type PenaltyRulesetEntry } from '../hooks/usePenalties';
import type { ExchangeSide, UseScoringSubmitResult } from '../hooks/useScoringSubmit';
import { enqueue } from '../offline/outbox';
import type { SyncEngine } from '../offline/sync';

interface ScoringColumnProps {
  side: ExchangeSide;
  apiUrl: string;
  matchId: string;
  nextSequence: number;
  /**
   * Durable-sync engine. A card goes through the outbox like a hit, so this is
   * what pushes it out once it is safely on disk.
   */
  syncEngine?: SyncEngine | null;
  registrationId: string;
  fighterName: string;
  club?: string | null;
  score: number;
  /**
   * How much of `score` is still queued on the tablet and not yet on the
   * server. Zero means the number is the server's. Non-zero marks it
   * provisional — the referee is looking at their own hits plus the last thing
   * the server confirmed, which is the honest answer offline and better than a
   * number that has silently stopped moving.
   */
  provisionalDelta?: number;
  /**
   * Cards queued but not sent. A card's points come from the active penalty
   * ruleset's per-card columns, which the pad does not read, so they are NOT in
   * `score` — the caption says so rather than letting an incomplete number
   * pass for a complete one.
   */
  queuedCardCount?: number;
  /** This side has won by reaching the point cap — highlights the score gold + cup. */
  reachedCap?: boolean;
  /** This side currently leads (not yet capped) — adds a subtle side-colour glow. */
  leading?: boolean;
  /** Locked match → read-only: hide the action controls, show score/name/cards only. */
  readOnly?: boolean;
  /** Point cap, shown as an "X / cap" caption + progress bar in normal scoring. */
  pointCap?: number;
  /** Reverse (zero-loses) scoring — suppresses the "X / cap" caption. */
  reverse?: boolean;
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

// raw-color-exempt -- penalty-card colours are DOMAIN values, not decoration:
// a yellow card is yellow on any surface, in any theme, at every event in the
// world. Same rule as the fighter corners (see theme.css) — themeing these
// would misreport a sanction. Kept literal rather than tokenized because they
// must never follow a [data-theme] scope.
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
  syncEngine,
  registrationId,
  fighterName,
  club,
  score,
  provisionalDelta = 0,
  queuedCardCount = 0,
  reachedCap,
  leading,
  readOnly,
  pointCap,
  reverse,
  config,
  scoringEnabled,
  canScore,
  clockTimeMs,
  submit,
  onPenaltyRecorded,
  penaltiesRefreshKey,
}: ScoringColumnProps) {
  const { t } = useI18n();
  const { padScope } = useScoringTheme();
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

  // Admin-pinned quick-pick penalties (config.display.quickPenalties = ref_numbers).
  const quickEntries = useMemo(
    () => entries.filter((e) => (config.display.quickPenalties ?? []).includes(e.ref_number)),
    [entries, config.display.quickPenalties],
  );

  const [penaltyQuery, setPenaltyQuery] = useState('');
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

  /**
   * Record a card — durable-first, exactly like a hit.
   *
   * This used to POST straight out, so a card issued in a hall with no wifi
   * errored and was LOST: the referee had to remember it and re-enter it later.
   * A card is a scored artefact that changes the score through the ruleset, so
   * it belongs in the same queue an exchange goes through.
   *
   * Nothing server-side had to change for this. `match_penalties.client_uuid`
   * is NOT NULL UNIQUE (migration 0016), penalties.service.ts already dedupes
   * on it, and `occurred_at` is client-supplied — so a card that drains twenty
   * minutes later still records the moment the referee raised it. Only the
   * outbox path was missing.
   */
  async function submitPenalty(payload: {
    rulesetEntryId?: string;
    directCard?: PenaltyCard;
    reason?: string;
  }) {
    setPenaltySubmitting(true);
    setPenaltyError(null);
    try {
      await enqueue({
        kind: 'penalty',
        clientUuid: crypto.randomUUID(),
        matchId,
        sequence: nextSequence,
        registrationId,
        occurredAt: new Date().toISOString(),
        clockTimeMs,
        ...payload,
      });
      // Online this drains immediately; offline it stays queued and goes on
      // reconnect. A refusal on drain (locked match, stale sequence) lands in
      // the quarantine inbox and reddens the sync bar — the existing path for a
      // refused scored artefact.
      await syncEngine?.drain();
      onPenaltyRecorded?.();
    } catch (err) {
      setPenaltyError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setPenaltySubmitting(false);
    }
  }

  return (
    // `data-side` on the root is what lets a test (or a debugging operator)
    // address ONE side: this component renders twice and every control inside
    // it — clean, afterblow, penalty rows, card chips — exists in both copies.
    <div className="flex flex-col gap-3 px-2" data-testid="scoring-column" data-side={side}>
      {/* Score numeral — gold when capped (winner), subtle side-colour glow when
          leading. Gold via the token, not a literal: theme.css brightens it to
          #fbbf24 on dark and keeps #f59e0b on light, so a hardcoded hex would
          wash out on a light pad. */}
      <p
        className="text-center text-8xl font-black tabular-nums leading-none mt-2"
        style={{
          color: reachedCap ? 'var(--color-gold)' : style.border,
          textShadow: reachedCap
            ? '0 0 14px color-mix(in srgb, var(--color-gold) 55%, transparent)'
            : leading
              ? `0 0 14px ${style.border}`
              : 'none',
        }}
      >
        {score}
      </p>
      {/* Under the numeral, deliberately OUTSIDE the button grid:
          08-offline-custom-ruleset asserts that no `clean-hit-button` contains
          the text "+2", so any numeric annotation inside those buttons would
          red it — and would be the wrong place anyway, since this is about the
          score rather than about what a button does. */}
      {(provisionalDelta !== 0 || queuedCardCount > 0) && (
        <p
          data-testid="provisional-score"
          data-provisional-delta={provisionalDelta}
          className="mt-1 text-center text-[11px] font-semibold leading-tight text-warning"
        >
          {provisionalDelta !== 0 &&
            t('scoring.lice.provisionalScore', { delta: String(provisionalDelta) })}
          {queuedCardCount > 0 && (
            <span className="block font-normal">
              {t('scoring.lice.provisionalCardExcluded', { count: String(queuedCardCount) })}
            </span>
          )}
        </p>
      )}
      {pointCap !== undefined && !reverse && (
        <>
          <p className="-mt-2 text-center text-sm font-semibold tabular-nums text-muted">
            {`${score} / ${pointCap}`}
          </p>
          {/* Cap-progress bar */}
          <div className="mx-auto h-1 w-24 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${Math.min(100, Math.round((score / pointCap) * 100))}%`,
                backgroundColor: reachedCap ? 'var(--color-gold)' : style.border,
              }}
            />
          </div>
        </>
      )}

      {/* Fighter name + club — live winner cup beside the name once capped. */}
      <div className="text-center">
        <p className="flex items-center justify-center gap-2 text-3xl font-bold text-foreground leading-tight truncate">
          {reachedCap && <span aria-hidden>🏆</span>}
          {fighterName}
        </p>
        {club && <p className="text-lg text-muted mt-0.5 truncate">{club}</p>}
      </div>

      {/* Card-counter chips (ruleset-driven) */}
      <div className="flex justify-center gap-2">
        {ruleSetCards.map((card) => {
          const count = countFor(registrationId, card);
          return (
            <span
              key={card}
              data-testid="card-chip"
              data-card={card}
              data-count={count}
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
      {!readOnly && visibleClean.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {t('scoring.lice.cleanHitsHeader')}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {visibleClean.map((btn) => (
              <button
                key={btn.label}
                data-testid="clean-hit-button"
                data-side={side}
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
                <span className="block text-[11px] font-semibold opacity-70">
                  {t('scoring.lice.pointsLabel')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AFTERBLOW */}
      {!readOnly && visibleAfterblows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {t('scoring.lice.afterblowHeader')}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {visibleAfterblows.map((btn) => {
              const d = computeAfterblowDeltas(
                config.afterblowMode,
                btn.attackerPts,
                btn.defenderPts,
              );
              const isFull = config.afterblowMode === 'full';
              return (
                <button
                  key={btn.label}
                  data-testid="afterblow-button"
                  data-side={side}
                  onClick={() => submit.submitAfterblow(side, btn)}
                  disabled={submit.submitting || !canScore}
                  className="min-h-[56px] rounded-xl border-2 bg-transparent font-bold text-lg flex flex-col items-center justify-center gap-1 disabled:opacity-40 transition-colors touch-manipulation"
                  // `bg-transparent`, so the ink lands on the PAGE, not on
                  // style.panel — style.text would be near-white on a light pad.
                  style={{ borderColor: style.border, color: outlineInkOn(style, padScope) }}
                  title={
                    isFull
                      ? t('scoring.pad.afterblowTitleFull', {
                          attacker: fighterName,
                          defender: '—',
                          attackerPts: d.attackerDelta,
                          defenderPts: d.defenderDelta,
                        })
                      : t('scoring.pad.afterblowTitleDeductive', {
                          attacker: fighterName,
                          defender: '—',
                          attackerPts: d.attackerDelta,
                        })
                  }
                >
                  {isFull ? (
                    // Full mode: drop the numeric label; two side-coloured pills show who scores.
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block min-w-[34px] rounded-md px-2 py-0.5 text-sm font-extrabold tabular-nums"
                        style={{ backgroundColor: style.panel, color: style.text }}
                      >
                        +{d.attackerDelta}
                      </span>
                      <span
                        className="inline-block min-w-[34px] rounded-md px-2 py-0.5 text-sm font-extrabold tabular-nums"
                        style={{ backgroundColor: otherStyle.panel, color: otherStyle.text }}
                      >
                        +{d.defenderDelta}
                      </span>
                    </span>
                  ) : (
                    // Deductive mode: keep the label + the net points the striker keeps.
                    <>
                      {btn.label}
                      <span className="block text-[11px] font-normal opacity-70">
                        {d.attackerDelta === 1
                          ? `${d.attackerDelta} ${t('scoring.lice.point')}`
                          : `${d.attackerDelta} ${t('scoring.lice.points')}`}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* PENALTIES — inline picker (hidden in the read-only / locked view). */}
      {!readOnly && (
        <div className="flex flex-col gap-2 mt-6 border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {t('scoring.lice.penaltiesHeader')}
          </p>

          {penaltyError && (
            <p className="rounded-lg bg-danger/20 px-3 py-2 text-xs text-danger">{penaltyError}</p>
          )}

          {quickEntries.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {quickEntries.map((entry) => {
                const card = entry.sanctions[0];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    data-testid="quick-penalty-button"
                    data-entry-id={entry.id}
                    disabled={penaltyDisabled}
                    onClick={() => void submitPenalty({ rulesetEntryId: entry.id })}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs font-semibold text-foreground hover:border-warning disabled:opacity-40"
                  >
                    {card && (
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-sm ${CARD_CHIP_COLOR[card]}`}
                      />
                    )}
                    {entry.short_name}
                  </button>
                );
              })}
            </div>
          )}

          <input
            value={penaltyQuery}
            onChange={(e) => setPenaltyQuery(e.target.value)}
            placeholder={t('scoring.lice.penaltySearch')}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-warning"
          />

          <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
            {filteredEntries.length === 0 && (
              <p className="text-center text-xs text-muted py-3">
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
        </div>
      )}

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
      data-testid="penalty-entry-button"
      data-entry-id={entry.id}
      disabled={disabled}
      onClick={onClick}
      className="w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:border-warning disabled:opacity-40 flex items-center gap-2"
    >
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-foreground">
          {entry.ref_number}. {entry.short_name}
        </span>
        <span className="block text-[10px] text-muted truncate">
          <span className="mr-1.5 rounded bg-border px-1 py-0.5 font-semibold text-muted">
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
