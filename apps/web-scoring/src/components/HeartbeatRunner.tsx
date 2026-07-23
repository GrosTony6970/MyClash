'use client';
import { useHeartbeat } from '../hooks/useHeartbeat';

/** Runs the tablet heartbeat for as long as it is mounted. Renders nothing. */
export function HeartbeatRunner() {
  useHeartbeat();
  return null;
}
