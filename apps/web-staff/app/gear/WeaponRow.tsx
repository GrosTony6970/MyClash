'use client';

import { useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';
import type { GearResult, WeaponStatus } from '../../src/lib/useGear';

interface Props {
  weapon: WeaponStatus;
  onRecord: (result: GearResult, reason?: string) => void;
}

// Literal keys, never a template — a computed t() key is invisible to
// t-key-references.test.ts, so its French string would ship missing.
const RESULT_KEYS: Record<GearResult, string> = {
  pass: 'scoring.gear.resultPass',
  fail: 'scoring.gear.resultFail',
  conditional: 'scoring.gear.resultConditional',
};

const RESULT_TONE: Record<GearResult, string> = {
  pass: 'text-success',
  fail: 'text-danger',
  conditional: 'text-warning',
};

/**
 * One weapon's state and its actions.
 *
 * An already-passed weapon collapses to its result plus a Re-check button,
 * because the common case is that there is nothing left to do — expanding three
 * buttons for every already-cleared weapon would bury the ones that still need
 * attention.
 */
export function WeaponRow({ weapon, onRecord }: Props) {
  const [asking, setAsking] = useState(false);
  const [recheck, setRecheck] = useState(false);
  const settled = weapon.result !== null && !recheck;

  // Clearing `recheck` on every write returns the row to its collapsed form,
  // so recording a result closes the re-check the volunteer opened.
  const record = (result: GearResult, reason?: string) => {
    setAsking(false);
    setRecheck(false);
    onRecord(result, reason);
  };
  const saveConditional = (reason: string) => record('conditional', reason);

  if (asking) {
    return (
      <ConditionalReason
        weaponName={weapon.weaponName}
        onCancel={() => setAsking(false)}
        onSave={saveConditional}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{weapon.weaponName}</span>
        <WeaponState weapon={weapon} />
      </div>

      {settled ? (
        <RecheckButton onClick={() => setRecheck(true)} />
      ) : (
        <ResultButtons
          onPass={() => record('pass')}
          onConditional={() => setAsking(true)}
          onFail={() => record('fail')}
        />
      )}
    </div>
  );
}

/**
 * A weapon already carrying a result collapses to this, because the common case
 * is that there is nothing left to do — three buttons on every cleared weapon
 * would bury the ones that still need attention.
 */
function RecheckButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
    >
      {t('scoring.gear.recheck')}
    </button>
  );
}

/**
 * Pass is one tap. Fail is one tap. Conditional opens the reason prompt —
 * it is the only one of the three that stops for input, because a conditional
 * with no text is indistinguishable from a pass at the piste.
 */
function ResultButtons({
  onPass,
  onConditional,
  onFail,
}: {
  onPass: () => void;
  onConditional: () => void;
  onFail: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onPass}
        className="min-h-[44px] flex-1 rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground [touch-action:manipulation]"
      >
        {t('scoring.gear.resultPass')}
      </button>
      <button
        type="button"
        onClick={onConditional}
        className="min-h-[44px] flex-1 rounded-lg border border-warning px-4 text-sm font-bold text-warning"
      >
        {t('scoring.gear.resultConditional')}
      </button>
      <button
        type="button"
        onClick={onFail}
        className="min-h-[44px] flex-1 rounded-lg border border-danger px-4 text-sm font-bold text-danger"
      >
        {t('scoring.gear.resultFail')}
      </button>
    </div>
  );
}

function WeaponState({ weapon }: { weapon: WeaponStatus }) {
  const { t } = useI18n();
  if (!weapon.result) {
    return <span className="text-xs text-muted">{t('scoring.gear.notChecked')}</span>;
  }

  return (
    <span className={`text-xs font-semibold ${RESULT_TONE[weapon.result]}`}>
      {t(RESULT_KEYS[weapon.result])}
      {weapon.reason ? ` · ${weapon.reason}` : ''}
    </span>
  );
}

/**
 * The one path that stops for input.
 *
 * Pass is one tap. Fail is one tap. Conditional cannot be saved without a
 * reason — by the time it reaches the piste, a conditional with no text is
 * indistinguishable from a pass, and the referee has no way to know what to
 * watch for. The API and the table refuse it too; this is what makes the
 * refusal legible instead of an error toast.
 */
function ConditionalReason({
  weaponName,
  onCancel,
  onSave,
}: {
  weaponName: string;
  onCancel: () => void;
  onSave: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const canSave = reason.trim().length > 0;

  return (
    <div className="rounded-lg border border-warning bg-surface p-3">
      <p className="text-sm font-semibold text-foreground">{weaponName}</p>
      <label htmlFor="gear-reason" className="mt-1 block text-xs text-warning">
        {t('scoring.gear.conditionalPrompt')}
      </label>
      <textarea
        id="gear-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
        >
          {t('scoring.gear.cancel')}
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave(reason.trim())}
          className="min-h-[44px] rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground disabled:opacity-40"
        >
          {t('scoring.gear.saveConditional')}
        </button>
      </div>
    </div>
  );
}
