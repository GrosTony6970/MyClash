/**
 * Hydrate Step 3 (Display / scoring buttons) from the persisted
 * `scoring_config` JSONB. Same pluck-not-spread discipline as Step 2
 * and Step 4 — even though the API DTO accepts `scoringConfig` as a
 * loose `Record<string, unknown>` today, we still strip unknown keys
 * here so a future schema tightening doesn't bring back the 400.
 */

export interface CleanButton {
  label: string;
  value: number;
  visible: boolean;
}

export interface AfterblowButton {
  label: string;
  attackerPts: number;
  defenderPts: number;
  visible: boolean;
}

export interface DisplayState {
  sideColors: { red: string; blue: string };
  buttons: { clean: CleanButton[]; afterblow: AfterblowButton[] };
}

export const DISPLAY_DEFAULTS: DisplayState = {
  sideColors: { red: 'red', blue: 'blue' },
  buttons: {
    clean: [{ label: 'Point', value: 1, visible: true }],
    afterblow: [{ label: 'Afterblow', attackerPts: 1, defenderPts: 1, visible: true }],
  },
};

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickClean(raw: unknown): CleanButton {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    label: str(r['label'], ''),
    value: num(r['value'], 0),
    visible: bool(r['visible'], true),
  };
}

function pickAfterblow(raw: unknown): AfterblowButton {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    label: str(r['label'], ''),
    attackerPts: num(r['attackerPts'], 0),
    defenderPts: num(r['defenderPts'], 0),
    visible: bool(r['visible'], true),
  };
}

export function buildDisplayConfigFromRow(
  scoringConfig: Record<string, unknown>,
  defaults: DisplayState,
): DisplayState {
  const display = (scoringConfig['display'] ?? {}) as Record<string, unknown>;
  const sideColors = (display['sideColors'] ?? {}) as Record<string, unknown>;
  const buttons = (scoringConfig['buttons'] ?? {}) as Record<string, unknown>;
  const cleanRaw = Array.isArray(buttons['clean']) ? (buttons['clean'] as unknown[]) : null;
  const afterblowRaw = Array.isArray(buttons['afterblow'])
    ? (buttons['afterblow'] as unknown[])
    : null;
  return {
    sideColors: {
      red: str(sideColors['red'], defaults.sideColors.red),
      blue: str(sideColors['blue'], defaults.sideColors.blue),
    },
    buttons: {
      clean: cleanRaw ? cleanRaw.map(pickClean) : defaults.buttons.clean,
      afterblow: afterblowRaw ? afterblowRaw.map(pickAfterblow) : defaults.buttons.afterblow,
    },
  };
}
