/**
 * Project `docker info --format '{{json .}}'` onto the handful of host facts the
 * admin command center shows: which machine this is, what it runs, how much
 * hardware it has.
 *
 * The docker daemon is the right source rather than `node:os`, because this code
 * runs inside a container. `os.hostname()` returns the container id and
 * /etc/os-release describes the sidecar's Debian, not the VPS. (`os.cpus()` and
 * `os.totalmem()` DO read through to the host on Linux, so they remain a usable
 * fallback for the two numbers — but not for the identity.)
 *
 * Lives outside server.mjs for the same reason disk.mjs does: server.mjs binds a
 * port and process.exit(1)s without OPS_RUNNER_SECRET, so nothing defined there
 * can be reached from a test.
 */

/**
 * Allowlist, not a passthrough. `docker info` also carries RegistryConfig, Swarm
 * state, SecurityOptions and — on a proxied host — HttpProxy/HttpsProxy, whose
 * URLs can embed credentials. Forwarding the blob and letting the UI pick would
 * put all of that one response away from a browser. Name what is wanted instead,
 * so a future daemon field cannot leak by default.
 */
export function parseDockerInfo(stdout) {
  const info = safeParse(stdout);
  return {
    hostname: text(info?.Name),
    os: text(info?.OperatingSystem),
    osVersion: text(info?.OSVersion),
    kernelVersion: text(info?.KernelVersion),
    architecture: text(info?.Architecture),
    cpuCount: count(info?.NCPU),
    memoryTotalBytes: count(info?.MemTotal),
    dockerVersion: text(info?.ServerVersion),
  };
}

/**
 * Malformed or empty output yields an all-null projection rather than throwing:
 * the caller has already decided the daemon answered, and a board that shows
 * four of six facts is worth more to an operator than one that shows an error.
 */
function safeParse(stdout) {
  try {
    const parsed = JSON.parse(String(stdout));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// `docker info` reports 0 for a value it could not determine, which would render
// as a confident "0 CPU" / "0 B" rather than as the absence it is.
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
