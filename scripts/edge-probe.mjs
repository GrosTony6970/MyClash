import http from 'node:http';
import https from 'node:https';

/**
 * Shared HTTP plumbing for the edge checks (`pnpm infra:edge`,
 * `pnpm infra:plugins`).
 *
 * Both scripts probe the same Traefik from the outside and both need the same
 * two things: argv parsing that does not eat the next flag, and a request that
 * resolves rather than throws so one dead host cannot abort the run. They were
 * copies of each other; one owner now, imported by name.
 *
 * No top-level side effects — importing this must never start a probe.
 */

export function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    // Bare flag: only swallow the next argv when it is a VALUE. Without this
    // `--deep --domain x` eats `--domain` and silently drops it.
    const next = rawArgs[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = '';
    }
  }
  return parsed;
}

/**
 * Resolves `{statusCode, headers, body}` — and `{statusCode: null, error}` on a
 * transport failure, never a rejection, so a caller can report every host
 * instead of dying on the first unreachable one.
 *
 * `servername` sets the TLS SNI independently of the socket address, which is
 * what lets a caller reach 127.0.0.1 while still being routed as
 * `app.myclash.fr`.
 */
export function request({
  protocol,
  host,
  servername,
  path,
  method = 'GET',
  timeoutMs = 10_000,
  headers,
  port,
  rejectUnauthorized = true,
}) {
  const client = protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = client.request(
      {
        protocol,
        host,
        port,
        servername,
        path,
        method,
        headers,
        timeout: timeoutMs,
        rejectUnauthorized,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (error) => {
      resolve({ statusCode: null, headers: {}, body: '', error });
    });
    req.end();
  });
}
