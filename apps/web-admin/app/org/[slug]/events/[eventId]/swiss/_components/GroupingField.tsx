'use client';

/**
 * How the PAIRING groups fighters — the setting that decides whether the format
 * is actually Swiss.
 *
 * Swiss pairs people on EQUAL value. A continuous ruleset score gives every
 * fighter a unique one, so every group holds a single person and the pairing
 * degenerates to a flat 1v2, 3v4 down the table: Swiss-shaped, not Swiss. That
 * is why this is configured separately from what the standings RANK on, and why
 * the copy says so out loud rather than leaving an organiser to discover it.
 *
 * The band preview runs `bandsOf` — the same function the engine pairs with —
 * over the live standings. A formula ruleset's score range is unknowable in
 * advance, so showing the organiser their actual field in their actual bands is
 * the only honest way to reveal a badly chosen set.
 */

import { useI18n } from '@myclash/next-i18n/client';
import { useMemo } from 'react';
import { bandsOf, type SwissPlayer } from '@myclash/rules';
import type { SwissGrouping } from '../useSwissAdmin';

export interface BandPreviewPlayer {
  registrationId: string;
  displayName: string;
  score: number | null;
}

export function GroupingField({
  grouping,
  players,
  disabled,
  disabledReason,
  onChange,
}: {
  grouping: SwissGrouping;
  /** The current standings, for the live preview. Empty before round 1. */
  players: BandPreviewPlayer[];
  disabled: boolean;
  disabledReason: string | null;
  onChange: (next: SwissGrouping) => void;
}) {
  const { t } = useI18n();

  // Memoised: a fresh `[]` on every render would re-run the band preview
  // (and re-run `bandsOf`) on every keystroke elsewhere in the form.
  const boundaries = useMemo(() => grouping.boundaries ?? [], [grouping.boundaries]);

  const bands = useMemo(() => {
    if (grouping.kind !== 'scoreBands' || boundaries.length === 0) return null;
    const asPlayers: SwissPlayer[] = players.map((player, index) => ({
      registrationId: player.registrationId,
      points: 0,
      score: player.score,
      opponentIds: [],
      hadBye: false,
      rank: index + 1,
    }));
    return bandsOf(asPlayers, boundaries);
  }, [grouping.kind, boundaries, players]);

  return (
    <fieldset className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.swiss.configure.groupingTitle')}
      </legend>
      <p className="text-xs text-foreground-secondary">
        {t('organizer.swiss.configure.groupingExplainer')}
      </p>

      <div className="flex flex-col gap-2">
        {(['points', 'scoreBands'] as const).map((kind) => (
          <label key={kind} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="swiss-grouping"
              className="mt-1"
              checked={grouping.kind === kind}
              disabled={disabled}
              onChange={() =>
                onChange(
                  kind === 'points'
                    ? { kind: 'points' }
                    : { kind: 'scoreBands', boundaries: boundaries.length ? boundaries : [0.5] },
                )
              }
            />
            <span>
              <span className="font-medium text-foreground">
                {t(`organizer.swiss.configure.grouping.${kind}`)}
              </span>
              <span className="block text-xs text-muted">
                {t(`organizer.swiss.configure.grouping.${kind}Hint`)}
              </span>
            </span>
          </label>
        ))}
      </div>

      {grouping.kind === 'scoreBands' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-foreground-secondary">
            {t('organizer.swiss.configure.boundariesLabel')}
            <input
              value={boundaries.join(', ')}
              disabled={disabled}
              onChange={(e) => onChange({ kind: 'scoreBands', boundaries: parse(e.target.value) })}
              placeholder="0.2, 0.4, 0.6, 0.8"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <p className="text-xs text-muted">{t('organizer.swiss.configure.boundariesHint')}</p>
          <BandPreview bands={bands} players={players} />
        </div>
      )}

      {disabled && disabledReason && <p className="text-xs text-warning">{disabledReason}</p>}
    </fieldset>
  );
}

function BandPreview({
  bands,
  players,
}: {
  bands: SwissPlayer[][] | null;
  players: BandPreviewPlayer[];
}) {
  const { t } = useI18n();

  if (!bands) return null;
  if (players.length === 0) {
    return (
      <p className="text-xs italic text-muted">{t('organizer.swiss.configure.bandsNoData')}</p>
    );
  }
  const nameOf = new Map(players.map((p) => [p.registrationId, p.displayName]));
  return (
    <ul className="space-y-1">
      {bands.map((band, index) => (
        <li key={index} className="rounded border border-border bg-background px-3 py-1.5 text-xs">
          <span className="font-semibold text-foreground">
            {t('organizer.swiss.configure.bandLabel', { index: index + 1, count: band.length })}
          </span>
          {band.length === 1 && (
            // A band of one has nobody to pair with, so its occupant downfloats
            // into the band below. Legal, and handled — but the organiser should
            // see it rather than wonder why the pairing crossed a boundary.
            <span className="ml-2 text-warning">
              {t('organizer.swiss.configure.bandSingleton')}
            </span>
          )}
          {band.length > 0 && (
            <span className="ml-2 text-muted">
              {band.map((p) => nameOf.get(p.registrationId) ?? '').join(', ')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "0.2, 0.4" → [0.2, 0.4]. Non-numbers dropped; the API validates the rest. */
function parse(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
}
