'use client';

import type { TimeSimulationMode } from '@myclash/feature-flags';
import { useSecondsClock } from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { getPublicApiUrl } from '@/lib/api-url';
import { buildTimeSimPayload, payloadAt, type TimeSimInput } from './time-sim-controls';

/** Steps through a Pool without typing dates: each moves the clock from where visitors see it. */
const NUDGES = [
  { minutes: -15, labelKey: 'admin.featureFlags.timeSimulation.nudgeBack15' },
  { minutes: 5, labelKey: 'admin.featureFlags.timeSimulation.nudgeForward5' },
  { minutes: 15, labelKey: 'admin.featureFlags.timeSimulation.nudgeForward15' },
  { minutes: 60, labelKey: 'admin.featureFlags.timeSimulation.nudgeForward60' },
] as const;

interface TimeSimulationControlsProps {
  busy: boolean;
  simLocal: string;
  onSimLocalChange: (value: string) => void;
  /** The mode last saved; a new date keeps it. */
  storedMode: TimeSimulationMode;
  onSave: (payloadJson: TimeSimInput) => void;
  t: (key: string, vars?: Record<string, string>) => string;
  locale: AppLocale;
}

/**
 * The `time_simulation` panel. The readout is the clock every visitor runs,
 * read from the same public snapshot and the same seconds clock, so what the
 * super-admin sees here is what the public app, the live board and the wall
 * show. Pause, Resume and the nudges take "now" from it, so the clock stops,
 * runs on, or moves from the instant visitors see. A nudge keeps the mode: a
 * paused clock stays paused at its new instant.
 */
export function TimeSimulationControls({
  busy,
  simLocal,
  onSimLocalChange,
  storedMode,
  onSave,
  t,
  locale,
}: TimeSimulationControlsProps) {
  const { nowMs, simulated, frozen } = useSecondsClock(getPublicApiUrl());
  const time = new Date(nowMs).toLocaleString(localeToBcp47(locale));

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground" role="status">
          {!simulated
            ? t('admin.featureFlags.timeSimulation.readoutReal')
            : frozen
              ? t('admin.featureFlags.timeSimulation.readoutFrozen', { time })
              : t('admin.featureFlags.timeSimulation.readoutRunning', { time })}
        </p>
        {simulated && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(payloadAt(nowMs, frozen ? 'running' : 'frozen'))}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {frozen
              ? t('admin.featureFlags.timeSimulation.resumeButton')
              : t('admin.featureFlags.timeSimulation.pauseButton')}
          </button>
        )}
      </div>
      {simulated && (
        <div
          role="group"
          aria-label={t('admin.featureFlags.timeSimulation.nudgeGroup')}
          className="flex flex-wrap gap-2"
        >
          {NUDGES.map(({ minutes, labelKey }) => (
            <button
              key={minutes}
              type="button"
              disabled={busy}
              onClick={() =>
                onSave(payloadAt(nowMs + minutes * 60_000, frozen ? 'frozen' : 'running'))
              }
              className="h-8 rounded-md border border-border bg-surface px-3 text-xs font-medium tabular-nums text-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground-secondary">
          {t('admin.featureFlags.timeSimulation.targetLabel')}
          <input
            type="datetime-local"
            value={simLocal}
            onChange={(e) => onSimLocalChange(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-sm text-foreground"
          />
          <span className="text-[11px] font-normal text-muted">
            {t('admin.featureFlags.timeSimulation.targetHelp')}
          </span>
        </label>
        <button
          type="button"
          disabled={busy || !simLocal}
          onClick={() => {
            const payload = buildTimeSimPayload(simLocal, storedMode);
            if (payload) onSave(payload);
          }}
          className="h-9 rounded-md bg-strong px-3 text-sm font-medium text-strong-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {t('admin.featureFlags.timeSimulation.saveButton')}
        </button>
      </div>
    </div>
  );
}
