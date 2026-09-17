'use client';

import type { ReactNode } from 'react';
import type { SuggestConfig } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { LENGTH_FIELDS, withTournamentField, type LengthField } from './sheet-rows';

/** A Tournament of the Event, as `GET /events/:eventId/tournaments` returns it. */
export interface TournamentOption {
  id: string;
  name: string;
}

/** The whole sheet after one box changed, and whether that box passes its own check. */
export type SheetEdit = (next: SuggestConfig, valid: boolean) => void;

type BoxKind = 'time' | 'length' | 'count';
type RequiredField = Exclude<keyof SuggestConfig, 'swissMatchDurationMinutes' | 'tournaments'>;

// Label keys spelled out in full. The i18n reverse sweep matches literal keys,
// and a key built from a shared prefix would mark every leaf under that prefix
// as used, orphans included.
const LABELS: Record<RequiredField | 'swissMatchDurationMinutes', string> = {
  dayStartTime: 'organizer.schedulePage.planner.config.dayStart',
  dayEndTime: 'organizer.schedulePage.planner.config.dayEnd',
  middayBreakStart: 'organizer.schedulePage.planner.config.middayBreakStart',
  middayBreakMinutes: 'organizer.schedulePage.planner.config.middayBreakMinutes',
  poolMatchDurationMinutes: 'organizer.schedulePage.planner.config.poolMatchDuration',
  swissMatchDurationMinutes: 'organizer.schedulePage.planner.config.swissMatchDuration',
  eliminationMatchDurationMinutes: 'organizer.schedulePage.planner.config.eliminationMatchDuration',
  finalsMatchDurationMinutes: 'organizer.schedulePage.planner.config.finalsMatchDuration',
  matchGapSeconds: 'organizer.schedulePage.planner.config.matchGap',
  minRestMinutes: 'organizer.schedulePage.planner.config.minRest',
  breakBetweenSessionsMinutes: 'organizer.schedulePage.planner.config.breakBetweenSessions',
  refereeMeetingDurationMinutes: 'organizer.schedulePage.planner.config.refereeMeeting',
  arrivalAndGearCheckMinutes: 'organizer.schedulePage.planner.config.arrivalAndGearCheck',
};

const KIND_LABELS: Record<LengthField, string> = {
  poolMatchDurationMinutes: 'organizer.schedulePage.planner.config.perTournament.pool',
  swissMatchDurationMinutes: 'organizer.schedulePage.planner.config.perTournament.swiss',
  eliminationMatchDurationMinutes:
    'organizer.schedulePage.planner.config.perTournament.elimination',
  finalsMatchDurationMinutes: 'organizer.schedulePage.planner.config.perTournament.finals',
};

const DAY_BOXES: ReadonlyArray<[RequiredField, BoxKind]> = [
  ['dayStartTime', 'time'],
  ['dayEndTime', 'time'],
  ['middayBreakStart', 'time'],
  ['middayBreakMinutes', 'count'],
];
const POOL_LENGTH_BOX: ReadonlyArray<[RequiredField, BoxKind]> = [
  ['poolMatchDurationMinutes', 'length'],
];
const BRACKET_LENGTH_BOXES: ReadonlyArray<[RequiredField, BoxKind]> = [
  ['eliminationMatchDurationMinutes', 'length'],
  ['finalsMatchDurationMinutes', 'length'],
];
const SPACING_BOXES: ReadonlyArray<[RequiredField, BoxKind]> = [['matchGapSeconds', 'count']];
const BLOCK_BOXES: ReadonlyArray<[RequiredField, BoxKind]> = [
  ['breakBetweenSessionsMinutes', 'count'],
  ['refereeMeetingDurationMinutes', 'count'],
  ['arrivalAndGearCheckMinutes', 'count'],
];

/** HH:MM with a real hour and minute. The API asks only for two digits each. */
export const TIME_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$';
const BOX_CLASS =
  'w-full min-w-0 border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent invalid:border-danger';

/**
 * Every box on the sheet passes its own check (pattern, min, step, required).
 * A save sends the whole sheet, so one half-typed box would have it refused.
 * Nothing saves until that box is fixed, and `invalid:` outlines it meanwhile.
 */
export function sheetValid(box: HTMLInputElement): boolean {
  return box.form?.checkValidity() === true;
}

/** One labelled box. `valid` is the whole sheet's check, not this box's. */
function SheetBox(props: {
  label: string;
  kind: BoxKind;
  value: string | number | undefined;
  required: boolean;
  placeholder?: string;
  onChange: (raw: string, valid: boolean) => void;
}) {
  const isTime = props.kind === 'time';
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted">{props.label}</span>
      <input
        type={isTime ? 'text' : 'number'}
        inputMode={isTime ? 'numeric' : undefined}
        pattern={isTime ? TIME_PATTERN : undefined}
        placeholder={isTime ? 'HH:MM' : props.placeholder}
        maxLength={isTime ? 5 : undefined}
        min={isTime ? undefined : props.kind === 'length' ? 1 : 0}
        step={isTime ? undefined : 1}
        required={props.required}
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value, sheetValid(e.currentTarget))}
        className={BOX_CLASS}
      />
    </label>
  );
}

/**
 * Boxes that always hold a value. A cleared number box reads as 0, which its
 * `min` refuses, so it is shown and not saved.
 */
function RequiredBoxes(props: {
  boxes: ReadonlyArray<[RequiredField, BoxKind]>;
  config: SuggestConfig;
  onEdit: SheetEdit;
}) {
  const { t } = useI18n();
  return props.boxes.map(([field, kind]) => (
    <SheetBox
      key={field}
      label={t(LABELS[field])}
      kind={kind}
      required
      value={props.config[field]}
      onChange={(raw, valid) =>
        props.onEdit({ ...props.config, [field]: kind === 'time' ? raw : Number(raw) }, valid)
      }
    />
  ));
}

function SheetGroup(props: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-foreground-secondary">{props.title}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">{props.children}</div>
    </fieldset>
  );
}

/**
 * One box on a Tournament's row. Blank hands the number back to the Event, so a
 * cleared box is `undefined` rather than 0 — and 0 stays a number the organiser
 * can mean, which is what the rest box needs.
 */
function TournamentBox(props: {
  ariaLabel: string;
  min: number;
  value: number | undefined;
  onChange: (minutes: number | undefined, valid: boolean) => void;
}) {
  return (
    <input
      type="number"
      min={props.min}
      step={1}
      aria-label={props.ariaLabel}
      value={props.value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        props.onChange(raw === '' ? undefined : Number(raw), sheetValid(e.currentTarget));
      }}
      className={BOX_CLASS}
    />
  );
}

/** One Tournament's four lengths and its own rest. A blank box reads the Event's. */
function TournamentRow(props: {
  tournament: TournamentOption;
  config: SuggestConfig;
  onEdit: SheetEdit;
}) {
  const { t } = useI18n();
  const { tournament, config } = props;
  const row = config.tournaments.find((r) => r.tournamentId === tournament.id);
  const edit = (tournaments: SuggestConfig['tournaments'], valid: boolean) =>
    props.onEdit({ ...config, tournaments }, valid);
  return (
    <>
      <span className="min-w-0 truncate text-xs text-foreground-secondary" title={tournament.name}>
        {tournament.name}
      </span>
      {LENGTH_FIELDS.map((field) => (
        <TournamentBox
          key={field}
          min={1}
          ariaLabel={t('organizer.schedulePage.planner.config.perTournament.inputAria', {
            kind: t(KIND_LABELS[field]),
            tournament: tournament.name,
          })}
          value={row?.[field]}
          onChange={(minutes, valid) =>
            edit(withTournamentField(config.tournaments, tournament.id, field, minutes), valid)
          }
        />
      ))}
      {/* Zero is allowed here and means this Tournament takes no break, even
          where the Event takes one. Blank reads the Event's. */}
      <TournamentBox
        min={0}
        ariaLabel={t('organizer.schedulePage.planner.config.perTournament.restAria', {
          tournament: tournament.name,
        })}
        value={row?.minRestMinutes}
        onChange={(minutes, valid) =>
          edit(
            withTournamentField(config.tournaments, tournament.id, 'minRestMinutes', minutes),
            valid,
          )
        }
      />
    </>
  );
}

function TournamentLengthRows(props: {
  tournaments: TournamentOption[];
  config: SuggestConfig;
  onEdit: SheetEdit;
}) {
  const { t } = useI18n();
  if (props.tournaments.length === 0) return null;
  return (
    <div className="col-span-2 space-y-1">
      <div className="text-xs text-muted">
        {t('organizer.schedulePage.planner.config.perTournament.title')}
      </div>
      <p className="text-xs text-muted">
        {t('organizer.schedulePage.planner.config.perTournament.blankMeansEvent')}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(5,3.25rem)] items-center gap-1">
        <span />
        {LENGTH_FIELDS.map((field) => (
          <span key={field} className="text-center text-xs text-muted">
            {t(KIND_LABELS[field])}
          </span>
        ))}
        <span className="text-center text-xs text-muted">
          {t('organizer.schedulePage.planner.config.perTournament.rest')}
        </span>
        {props.tournaments.map((tournament) => (
          <TournamentRow
            key={tournament.id}
            tournament={tournament}
            config={props.config}
            onEdit={props.onEdit}
          />
        ))}
      </div>
    </div>
  );
}

/** The four Event lengths, the Tournament rows, then the spacing between bouts. */
function BoutsGroup(props: {
  tournaments: TournamentOption[];
  config: SuggestConfig;
  onEdit: SheetEdit;
}) {
  const { t } = useI18n();
  const { config, onEdit } = props;
  return (
    <SheetGroup title={t('organizer.schedulePage.planner.config.groups.bouts')}>
      <RequiredBoxes boxes={POOL_LENGTH_BOX} config={config} onEdit={onEdit} />
      {/* Blank is a real value here: a Swiss bout then takes the pool length. */}
      <SheetBox
        label={t(LABELS.swissMatchDurationMinutes)}
        kind="length"
        required={false}
        value={config.swissMatchDurationMinutes}
        placeholder={String(config.poolMatchDurationMinutes)}
        onChange={(raw, valid) =>
          onEdit(
            { ...config, swissMatchDurationMinutes: raw === '' ? undefined : Number(raw) },
            valid,
          )
        }
      />
      <RequiredBoxes boxes={BRACKET_LENGTH_BOXES} config={config} onEdit={onEdit} />
      {/* Emptying it is how an organiser says "no break" (ADR-018). Blank and 0
          are the same answer here, so 0 is SHOWN as blank: the box an organiser
          cleared stays cleared when the sheet loads again. A Tournament's own
          box is not like this — there blank hands the number back to the
          Event, so its 0 has to stay visible. */}
      <SheetBox
        label={t(LABELS.minRestMinutes)}
        kind="count"
        required={false}
        value={config.minRestMinutes === 0 ? '' : config.minRestMinutes}
        onChange={(raw, valid) =>
          onEdit({ ...config, minRestMinutes: raw === '' ? 0 : Number(raw) }, valid)
        }
      />
      <p className="col-span-2 text-xs text-muted">
        {t('organizer.schedulePage.planner.config.sheetIsPlanningHint')}
      </p>
      <TournamentLengthRows tournaments={props.tournaments} config={config} onEdit={onEdit} />
      <RequiredBoxes boxes={SPACING_BOXES} config={config} onEdit={onEdit} />
    </SheetGroup>
  );
}

/** The planner sheet's boxes, in ADR-021's three groups: Day, Matches, Blocks. */
export function ProgrammeSheetInputs(props: {
  config: SuggestConfig;
  tournaments: TournamentOption[];
  onEdit: SheetEdit;
}) {
  const { t } = useI18n();
  const { config, onEdit } = props;
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => e.preventDefault()}>
      <SheetGroup title={t('organizer.schedulePage.planner.config.groups.day')}>
        <RequiredBoxes boxes={DAY_BOXES} config={config} onEdit={onEdit} />
      </SheetGroup>
      <BoutsGroup tournaments={props.tournaments} config={config} onEdit={onEdit} />
      <SheetGroup title={t('organizer.schedulePage.planner.config.groups.blocks')}>
        <RequiredBoxes boxes={BLOCK_BOXES} config={config} onEdit={onEdit} />
      </SheetGroup>
    </form>
  );
}
