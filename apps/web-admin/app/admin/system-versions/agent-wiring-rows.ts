import type { TileRow } from './queue-rows';

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface WakeState {
  config: 'configured' | 'not_configured' | 'misconfigured';
  checkedAt: string;
  lastFiredAt: string | null;
  lastStatus: number | null;
}

/** The worker's wake-up state, as the console's runtime-health answer carries it (slice 5). */
export type AgentWakeReading =
  { read: 'ok'; state: WakeState } | { read: 'not_checked' } | { read: 'unreadable' };

/**
 * The card's lines on the ops agent's wake-up: whether the worker can start the cloud task, when
 * it last looked (an old time means the worker stopped), and its last call. No line names an
 * environment key.
 */
export function agentWakeRows(
  t: Translate,
  wake: AgentWakeReading,
  formatTime: (iso: string) => string,
): TileRow[] {
  const label = t('admin.systemVersions.runtimeHealth.agent.wake');
  switch (wake.read) {
    case 'not_checked':
      return [[label, t('admin.systemVersions.runtimeHealth.agent.notChecked')]];
    case 'unreadable':
      return [[label, t('admin.systemVersions.runtimeHealth.agent.unreadable'), 'warning']];
    case 'ok':
      return configRows(t, label, wake.state, formatTime);
  }
}

/** The tile's pill: off is grey; a missing half, an unreadable state or a failed call is a warning. */
export function agentTileStatus(wake: AgentWakeReading): 'healthy' | 'warning' | 'not_configured' {
  if (wake.read === 'unreadable') return 'warning';
  if (wake.read === 'not_checked' || wake.state.config === 'not_configured')
    return 'not_configured';
  if (wake.state.config === 'misconfigured') return 'warning';
  const { lastFiredAt, lastStatus } = wake.state;
  const answered = lastStatus !== null && lastStatus >= 200 && lastStatus < 300;
  return lastFiredAt === null || answered ? 'healthy' : 'warning';
}

function configRows(
  t: Translate,
  label: string,
  state: WakeState,
  formatTime: (iso: string) => string,
): TileRow[] {
  switch (state.config) {
    case 'not_configured':
      return [[label, t('admin.systemVersions.runtimeHealth.agent.notConfigured')]];
    case 'misconfigured':
      return [[label, t('admin.systemVersions.runtimeHealth.agent.misconfigured'), 'warning']];
    case 'configured':
      return [
        [
          label,
          t('admin.systemVersions.runtimeHealth.agent.configured', {
            time: formatTime(state.checkedAt),
          }),
        ],
        [t('admin.systemVersions.runtimeHealth.agent.lastCall'), lastCall(t, state, formatTime)],
      ];
  }
}

function lastCall(t: Translate, state: WakeState, formatTime: (iso: string) => string): string {
  if (state.lastFiredAt === null) return t('admin.systemVersions.runtimeHealth.agent.noCallYet');
  const answer =
    state.lastStatus === null
      ? t('admin.systemVersions.runtimeHealth.agent.noAnswer')
      : String(state.lastStatus);
  return t('admin.systemVersions.runtimeHealth.agent.callAt', {
    time: formatTime(state.lastFiredAt),
    answer,
  });
}
