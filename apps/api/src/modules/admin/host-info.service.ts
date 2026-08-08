import { cpus, totalmem } from 'node:os';
import { Injectable } from '@nestjs/common';
import type { HostInfoResponseDto } from './dto/host-info.dto';
import type { AdminSystemActionsService } from './system-actions.service';

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

    const base: HostInfoResponseDto = {
      checkedAt: new Date().toISOString(),
      source: facts.status === 'fulfilled' ? 'docker' : 'runtime',
      hostname: null,
      os: null,
      osVersion: null,
      kernelVersion: null,
      architecture: null,
      dockerVersion: null,
      // Read through to the HOST even from inside a container on Linux: Node
      // reports /proc/cpuinfo and /proc/meminfo, which Docker does not virtualise.
      // They are not cgroup-aware, so they are the host's capacity — which is
      // exactly what this panel is about, and what the DTO doc-comment warns is
      // NOT the api container's own budget.
      cpuCount: cpus().length || null,
      memoryTotalBytes: totalmem() || null,
      diskTotalBytes: null,
      diskUsedBytes: null,
      diskAvailBytes: null,
      diskMountpoint: null,
    };

    if (facts.status === 'fulfilled') {
      const v = facts.value;
      base.hostname = v.hostname;
      base.os = v.os;
      base.osVersion = v.osVersion;
      base.kernelVersion = v.kernelVersion;
      base.architecture = v.architecture;
      base.dockerVersion = v.dockerVersion;
      // Prefer the daemon's numbers, but keep the node:os reading when it could
      // not determine one — a partial daemon answer should never be worse than
      // no daemon at all.
      base.cpuCount = v.cpuCount ?? base.cpuCount;
      base.memoryTotalBytes = v.memoryTotalBytes ?? base.memoryTotalBytes;
    }

    if (disk.status === 'fulfilled') {
      base.diskTotalBytes = disk.value.sizeBytes;
      base.diskUsedBytes = disk.value.usedBytes;
      base.diskAvailBytes = disk.value.availBytes;
      base.diskMountpoint = disk.value.mountpoint;
    }

    if (facts.status === 'rejected' && disk.status === 'rejected') {
      // Nothing came back from the sidecar at all. cpuCount and memoryTotalBytes
      // are still populated above from this process, so the panel is not empty —
      // but `unknown` tells the UI not to present it as a complete answer.
      base.source = 'unknown';
    }

    const reason = errorText(facts) ?? errorText(disk);
    if (reason) base.error = reason;

    return base;
  }
}

function errorText(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled') return null;
  return result.reason instanceof Error ? result.reason.message : 'ops-runner request failed';
}
