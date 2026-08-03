'use client';

/**
 * One Swiss round: its bouts, its bye, its badges and its overrides.
 *
 * Every badge here has a reason to be public-facing too (decision 16) — a
 * forced rematch and a manual adjustment are both things a fighter is entitled
 * to see, so the wording matches the spectator tab rather than inventing an
 * insider vocabulary.
 */

import { t } from '@myclash/i18n';
import { StatusBadge, matchStatusSemantic } from '@myclash/ui';
import type { SwissAdminMatch, SwissAdminRound } from '../useSwissAdmin';

export function RoundCard({
  round,
  nameOf,
  locked,
  busy,
  advanced,
  selectedRegistrationId,
  isLast,
  onPick,
  onDelete,
  onSetSides,
}: {
  round: SwissAdminRound;
  nameOf: (registrationId: string | null) => string;
  locked: boolean;
  busy: boolean;
  advanced: boolean;
  selectedRegistrationId: string | null;
  isLast: boolean;
  onPick: (registrationId: string) => void;
  onDelete: () => void;
  onSetSides: (matchId: string, red: string | null, blue: string | null) => void;
}) {
  // The override window IS the round's status: it opens when the round is
  // paired and closes when its first bout starts.
  const editable = !locked && round.status === 'pending';
  const rematchIds = new Set(
    round.warnings
      .filter((warning) => warning.code === 'forced-rematch')
      .flatMap((warning) => warning.registrationIds),
  );

  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-foreground">
            {t('organizer.swiss.rounds.roundTitle', { round: round.roundNumber })}
          </h3>
          <StatusBadge semantic={matchStatusSemantic(round.status)}>{round.status}</StatusBadge>
          {round.manualAdjustments.length > 0 && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
              {t('organizer.swiss.rounds.manuallyAdjusted')}
            </span>
          )}
          {rematchIds.size > 0 && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
              {t('organizer.swiss.rounds.forcedRematch')}
            </span>
          )}
        </div>
        {isLast && editable && (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="rounded border border-danger/40 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-40"
          >
            {t('organizer.swiss.rounds.delete')}
          </button>
        )}
      </header>

      {!round.validity.valid && <ValidityBanner round={round} nameOf={nameOf} />}

      <ul className="divide-y divide-border">
        {round.matches.map((match) => (
          <MatchRow
            key={match.id}
            match={match}
            nameOf={nameOf}
            rematchIds={rematchIds}
            editable={editable}
            busy={busy}
            advanced={advanced}
            selectedRegistrationId={selectedRegistrationId}
            onPick={onPick}
            onSetSides={onSetSides}
          />
        ))}
        {round.byeRegistrationId && (
          <li className="flex items-center gap-2 px-4 py-2.5 text-sm">
            <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold text-muted">
              {t('organizer.swiss.rounds.bye')}
            </span>
            <FighterButton
              registrationId={round.byeRegistrationId}
              label={nameOf(round.byeRegistrationId)}
              editable={editable}
              busy={busy}
              selected={selectedRegistrationId === round.byeRegistrationId}
              rematch={false}
              onPick={onPick}
            />
          </li>
        )}
      </ul>

      {editable && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          {t('organizer.swiss.rounds.swapHint')}
        </p>
      )}
    </section>
  );
}

function MatchRow({
  match,
  nameOf,
  rematchIds,
  editable,
  busy,
  advanced,
  selectedRegistrationId,
  onPick,
  onSetSides,
}: {
  match: SwissAdminMatch;
  nameOf: (registrationId: string | null) => string;
  rematchIds: Set<string>;
  editable: boolean;
  busy: boolean;
  advanced: boolean;
  selectedRegistrationId: string | null;
  onPick: (registrationId: string) => void;
  onSetSides: (matchId: string, red: string | null, blue: string | null) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <span className="w-24 shrink-0 font-mono text-xs text-muted">{match.matchNumberLabel}</span>
      <FighterButton
        registrationId={match.redRegistrationId}
        label={nameOf(match.redRegistrationId)}
        editable={editable}
        busy={busy}
        selected={selectedRegistrationId === match.redRegistrationId}
        rematch={Boolean(match.redRegistrationId && rematchIds.has(match.redRegistrationId))}
        onPick={onPick}
      />
      <span className="text-xs text-muted">
        {match.redScore ?? '–'} : {match.blueScore ?? '–'}
      </span>
      <FighterButton
        registrationId={match.blueRegistrationId}
        label={nameOf(match.blueRegistrationId)}
        editable={editable}
        busy={busy}
        selected={selectedRegistrationId === match.blueRegistrationId}
        rematch={Boolean(match.blueRegistrationId && rematchIds.has(match.blueRegistrationId))}
        onPick={onPick}
      />
      {match.liceName && <span className="text-xs text-muted">{match.liceName}</span>}
      <StatusBadge semantic={matchStatusSemantic(match.status)}>{match.status}</StatusBadge>
      {advanced && editable && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSetSides(match.id, match.blueRegistrationId, match.redRegistrationId)}
          title={t('organizer.swiss.rounds.setSidesHelp')}
          className="ml-auto rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:border-warning hover:text-warning disabled:opacity-40"
        >
          {t('organizer.swiss.rounds.setSides')}
        </button>
      )}
    </li>
  );
}

function FighterButton({
  registrationId,
  label,
  editable,
  busy,
  selected,
  rematch,
  onPick,
}: {
  registrationId: string | null;
  label: string;
  editable: boolean;
  busy: boolean;
  selected: boolean;
  rematch: boolean;
  onPick: (registrationId: string) => void;
}) {
  const classes = [
    'rounded px-2 py-1 text-sm',
    rematch ? 'text-warning' : 'text-foreground',
    selected ? 'bg-accent text-accent-foreground' : '',
  ].join(' ');

  if (!registrationId) {
    return <span className="rounded px-2 py-1 text-sm italic text-muted">{label || '—'}</span>;
  }
  if (!editable) return <span className={classes}>{label}</span>;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onPick(registrationId)}
      aria-pressed={selected}
      className={`${classes} border border-transparent hover:border-accent disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

/**
 * What `validateSwissRound` found. Rendered loudly because an invalid round
 * BLOCKS the next one from being paired — if this is not obvious, the tournament
 * looks stalled for no visible reason.
 */
function ValidityBanner({
  round,
  nameOf,
}: {
  round: SwissAdminRound;
  nameOf: (registrationId: string | null) => string;
}) {
  const groups: Array<[string, string[]]> = [
    ['duplicated', round.validity.duplicated],
    ['missing', round.validity.missing],
    ['unknown', round.validity.unknown],
  ];
  return (
    <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">
      <p className="font-semibold">{t('organizer.swiss.rounds.invalidTitle')}</p>
      {groups.map(([key, ids]) =>
        ids.length === 0 ? null : (
          <p key={key}>
            {t(`organizer.swiss.rounds.invalid.${key}`)}: {ids.map((id) => nameOf(id)).join(', ')}
          </p>
        ),
      )}
    </div>
  );
}
