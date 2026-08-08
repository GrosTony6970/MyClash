/**
 * Where the platform actually runs: machine identity and raw capacity.
 *
 * Every one of these is a **host** value, not a container one. The api container
 * is capped at `cpus: 2` / `mem_limit: 1g` in docker-compose.prod.yml and there
 * is no cgroup-aware code anywhere in this repo, so "16 CPU / 16 GB" must not be
 * read as headroom the API can use — it is the size of the box the whole stack
 * shares. The admin card says so on screen for the same reason.
 *
 * Capacity only, deliberately. Live pressure (disk %, connection counts, queue
 * backlog) belongs to the runtime-health panel directly below it, which owns
 * thresholds and alerting; a second, unalerted copy of the same numbers would
 * eventually disagree with the first.
 */
export type HostInfoSource = 'docker' | 'runtime' | 'unknown';

export interface HostInfoResponseDto {
  checkedAt: string;
  /**
   * Where the numbers came from, so the UI can be honest about a partial answer:
   * `docker` is the full picture from the daemon; `runtime` means the sidecar was
   * unreachable and only CPU/RAM survive, read from this process; `unknown` means
   * nothing could be read at all.
   */
  source: HostInfoSource;
  hostname: string | null;
  os: string | null;
  osVersion: string | null;
  kernelVersion: string | null;
  architecture: string | null;
  dockerVersion: string | null;
  cpuCount: number | null;
  memoryTotalBytes: number | null;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskAvailBytes: number | null;
  diskMountpoint: string | null;
  /** Why the answer is partial. Present only when `source !== 'docker'`. */
  error?: string;
}
