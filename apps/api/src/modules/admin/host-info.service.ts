import { cpus, totalmem } from 'node:os';
import { Injectable } from '@nestjs/common';
import type { HostInfoResponseDto, HostInfoSource } from './dto/host-info.dto';
import type {
  AdminSystemActionsService,
  DiskUsageResult,
  HostFactsResult,
} from './system-actions.service';

/**
 * Assembles the "what is this running on?" panel from two independent ops-runner
 * reads, and — unlike every other consumer of that sidecar — never throws.
 *
 * That divergence is deliberate. `getDiskUsage()` feeds a health metric, where an
 * exception is the honest answer because "unavailable" is itself a status the
 * operator must act on. This is descriptive inventory: a hostname the operator
 * already half-knows, next to a CPU count. Failing the whole panel because the
 * sidecar is restarting would hide the facts that are still perfectly readable.
 */
@Injectable()
export class AdminHostInfoService {
  constructor(private readonly systemActions: AdminSystemActionsService) {}

  async collect(): Promise<HostInfoResponseDto> {
    // allSettled, not all: a `df` failure must not erase the hostname, and a
    // daemon failure must not erase the disk. Same reasoning as the four
    // collectors in runtime-health.service.ts.
    const [facts, disk] = await Promise.allSettled([
      this.systemActions.getHostFacts(),
      this.systemActions.getDiskUsage(),
    ]);

    const result = processReading(sourceFor(facts, disk));
    if (facts.status === 'fulfilled') applyHostFacts(result, facts.value);
    if (disk.status === 'fulfilled') applyDiskUsage(result, disk.value);

    const reason = errorText(facts) ?? errorText(disk);
    if (reason) result.error = reason;

    return result;
  }
}

/**
 * What this process can say on its own, before either sidecar read lands.
 *
 * `cpus()` and `totalmem()` read through to the HOST even from inside a container
 * on Linux: Node reports /proc/cpuinfo and /proc/meminfo, which Docker does not
 * virtualise. They are not cgroup-aware, so they are the host's capacity — which
 * is exactly what this panel is about, and what the DTO doc-comment warns is NOT
 * the api container's own budget.
 */
function processReading(source: HostInfoSource): HostInfoResponseDto {
  return {
    checkedAt: new Date().toISOString(),
    source,
    hostname: null,
    os: null,
    osVersion: null,
    kernelVersion: null,
    architecture: null,
    dockerVersion: null,
    cpuCount: cpus().length || null,
    memoryTotalBytes: totalmem() || null,
    diskTotalBytes: null,
    diskUsedBytes: null,
    diskAvailBytes: null,
    diskMountpoint: null,
  };
}

/**
 * `unknown` means nothing came back from the sidecar at all. The panel is still
 * not empty — CPU and RAM come from this process — but the UI must not present
 * a two-fact answer as a complete one.
 */
function sourceFor(
  facts: PromiseSettledResult<unknown>,
  disk: PromiseSettledResult<unknown>,
): HostInfoSource {
  if (facts.status === 'fulfilled') return 'docker';
  return disk.status === 'fulfilled' ? 'runtime' : 'unknown';
}

function applyHostFacts(target: HostInfoResponseDto, facts: HostFactsResult): void {
  target.hostname = facts.hostname;
  target.os = facts.os;
  target.osVersion = facts.osVersion;
  target.kernelVersion = facts.kernelVersion;
  target.architecture = facts.architecture;
  target.dockerVersion = facts.dockerVersion;
  // Prefer the daemon's numbers, but keep the node:os reading where it could not
  // determine one — a partial daemon answer must never be worse than no daemon.
  target.cpuCount = facts.cpuCount ?? target.cpuCount;
  target.memoryTotalBytes = facts.memoryTotalBytes ?? target.memoryTotalBytes;
}

function applyDiskUsage(target: HostInfoResponseDto, disk: DiskUsageResult): void {
  target.diskTotalBytes = disk.sizeBytes;
  target.diskUsedBytes = disk.usedBytes;
  target.diskAvailBytes = disk.availBytes;
  target.diskMountpoint = disk.mountpoint;
}

function errorText(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled') return null;
  return result.reason instanceof Error ? result.reason.message : 'ops-runner request failed';
}
