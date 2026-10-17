import { TIME_SIMULATION_MODES, type TimeSimulationMode } from '@myclash/feature-flags';

/**
 * Pure helpers for the `time_simulation` panel: reading the stored payload
 * and building what the panel sends. The API stamps the anchor itself.
 */

/**
 * What the panel sends: the instant the clock reads, and whether it runs from
 * there. A type, not an interface, so it fits the save's `Record<string, unknown>`.
 */
export type TimeSimInput = {
  simulatedNowIso: string;
  mode: TimeSimulationMode;
};

/** Read the stored simulated "now" ISO (for the `time_simulation` flag). */
export function readSimulatedNowIso(
  raw: Record<string, unknown> | null | undefined,
): string | null {
  if (!raw) return null;
  return typeof raw['simulatedNowIso'] === 'string' ? (raw['simulatedNowIso'] as string) : null;
}

/**
 * Read the stored mode. A flag never saved has none, and its first save
 * starts a running clock.
 */
export function readTimeSimMode(
  raw: Record<string, unknown> | null | undefined,
): TimeSimulationMode {
  const mode = raw?.['mode'];
  return TIME_SIMULATION_MODES.includes(mode as TimeSimulationMode)
    ? (mode as TimeSimulationMode)
    : 'running';
}

/** UTC ISO instant → a `datetime-local` value (`YYYY-MM-DDTHH:mm`, admin-local). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value → the `time_simulation` payload, keeping the clock's mode. */
export function buildTimeSimPayload(
  localValue: string,
  mode: TimeSimulationMode,
): TimeSimInput | undefined {
  if (!localValue) return undefined;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return undefined;
  return { simulatedNowIso: d.toISOString(), mode };
}

/**
 * The clock set to `nowMs` in `mode`. Pause is the clock now, frozen; Resume
 * is the clock now (the frozen value), running — the API re-stamps the
 * anchor, so it runs on from where it stopped.
 */
export function payloadAt(nowMs: number, mode: TimeSimulationMode): TimeSimInput {
  return { simulatedNowIso: new Date(nowMs).toISOString(), mode };
}
