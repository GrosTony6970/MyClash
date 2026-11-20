import type { TileRow } from './queue-rows';

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface WakeState {
  config: 'configured' | 'not_configured' | 'misconfigured';
  checkedAt: string;
  lastFiredAt: string | null;
  lastStatus: number | null;
}

interface WatcherState {
  config: 'configured' | 'not_configured';
  checkedAt: string;
  lastOkAt: string | null;
  failing: boolean;
}

type Reading<T> = { read: 'ok'; state: T } | { read: 'not_checked' } | { read: 'unreadable' };

/** The worker's wake-up state, as the console's runtime-health answer carries it (slice 5). */
export type AgentWakeReading = Reading<WakeState>;
/** The worker's outside-watcher ping state (slice 5, ruling 903). */
export type AgentWatcherReading = Reading<WatcherState>;

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

type WireStatus = 'healthy' | 'warning' | 'not_configured';

/**
 * The tile's pill: a warning when either wire has one; grey when neither is set; healthy
 * otherwise. `seenAt` is this read's own time (the snapshot's `checkedAt`): a configured wire
 * the worker last looked at three ticks before it means the worker stopped.
 */
export function agentTileStatus(
  wake: AgentWakeReading,
  watcher: AgentWatcherReading,
  seenAt: number,
): WireStatus {
  const stale = (checkedAt: string) => seenAt - Date.parse(checkedAt) > STALE_MS;
  const both = [wakeStatus(wake, stale), watcherStatus(watcher, stale)];
  if (both.includes('warning')) return 'warning';
  return both.includes('healthy') ? 'healthy' : 'not_configured';
}

/** Three 5-minute ticks. */
const STALE_MS = 15 * 60_000;

/** A missing half, an unreadable or old state, or a failed call is a warning. */
function wakeStatus(wake: AgentWakeReading, stale: (iso: string) => boolean): WireStatus {
  if (wake.read === 'unreadable') return 'warning';
  if (wake.read === 'not_checked' || wake.state.config === 'not_configured') {
    return 'not_configured';
  }
  if (wake.state.config === 'misconfigured' || stale(wake.state.checkedAt)) return 'warning';
  const { lastFiredAt, lastStatus } = wake.state;
  const answered = lastStatus !== null && lastStatus >= 200 && lastStatus < 300;
  return lastFiredAt === null || answered ? 'healthy' : 'warning';
}

function watcherStatus(watcher: AgentWatcherReading, stale: (iso: string) => boolean): WireStatus {
  if (watcher.read === 'unreadable') return 'warning';
  if (watcher.read === 'not_checked' || watcher.state.config === 'not_configured') {
    return 'not_configured';
  }
  return watcher.state.failing || stale(watcher.state.checkedAt) ? 'warning' : 'healthy';
}

/** The outside watcher's line (ruling 903): pinging, and when it last answered; or not. */
export function agentWatcherRows(
  t: Translate,
  watcher: AgentWatcherReading,
  formatTime: (iso: string) => string,
): TileRow[] {
  const label = t('admin.systemVersions.runtimeHealth.agent.watcher');
  if (watcher.read === 'not_checked') {
    return [[label, t('admin.systemVersions.runtimeHealth.agent.notChecked')]];
  }
  if (watcher.read === 'unreadable') {
    return [[label, t('admin.systemVersions.runtimeHealth.agent.unreadable'), 'warning']];
  }
  const { config, checkedAt, lastOkAt, failing } = watcher.state;
  if (config === 'not_configured') {
    return [[label, t('admin.systemVersions.runtimeHealth.agent.notConfigured')]];
  }
  if (failing) {
    const time = formatTime(checkedAt);
    return [[label, t('admin.systemVersions.runtimeHealth.agent.pingFailed', { time }), 'warning']];
  }
  const time = formatTime(lastOkAt ?? checkedAt);
  return [[label, t('admin.systemVersions.runtimeHealth.agent.pinging', { time })]];
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
