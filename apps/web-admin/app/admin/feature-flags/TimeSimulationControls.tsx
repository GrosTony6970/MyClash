'use client';

import { useSecondsClock } from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { getPublicApiUrl } from '@/lib/api-url';
import { buildTimeSimPayload } from './time-sim-controls';

interface TimeSimulationControlsProps {
  busy: boolean;
  simLocal: string;
  onSimLocalChange: (value: string) => void;
  onSave: (payloadJson: Record<string, unknown>) => void;
  t: (key: string, vars?: Record<string, string>) => string;
  locale: AppLocale;
}

/**
 * The `time_simulation` panel. The readout is the clock every visitor runs,
 * read from the same public snapshot and the same seconds clock, so what the
 * super-admin sees here is what the public app, the live board and the wall
 * show.
 */
export function TimeSimulationControls({
  busy,
  simLocal,
  onSimLocalChange,
  onSave,
  t,
  locale,
}: TimeSimulationControlsProps) {
  const { nowMs, simulated } = useSecondsClock(getPublicApiUrl());

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <p className="text-sm font-medium text-foreground" role="status">
        {simulated
          ? t('admin.featureFlags.timeSimulation.readoutSimulated', {
              time: new Date(nowMs).toLocaleString(localeToBcp47(locale)),
            })
          : t('admin.featureFlags.timeSimulation.readoutReal')}
      </p>
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
            const payload = buildTimeSimPayload(simLocal);
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
