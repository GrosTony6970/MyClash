/**
 * Parse `df -P -B1 <dir>` output (POSIX format, sizes in bytes). The data row
 * may wrap if the filesystem name is long, but `-P` guarantees a single row.
 *
 * Lives outside server.mjs so it stays importable: server.mjs listens on a port
 * and `process.exit(1)`s without OPS_RUNNER_SECRET, so anything defined there
 * cannot be reached from a test.
 */
export function parseDfOutput(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/);
  const dataLine = lines[lines.length - 1];
  const cols = dataLine.trim().split(/\s+/);
  // Filesystem 1B-blocks Used Available Capacity% Mounted-on
  const [filesystem, size, used, avail, capacity, ...mount] = cols;
  return {
    filesystem,
    sizeBytes: Number(size),
    usedBytes: Number(used),
    availBytes: Number(avail),
    usePercent: Number(String(capacity).replace('%', '')),
    mountpoint: mount.join(' '),
  };
}
