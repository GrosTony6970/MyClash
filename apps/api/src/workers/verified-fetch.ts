import https from 'node:https';

/** The part of `fetch` the wake-up and the ping use. */
export type HttpCall = (url: string, init: RequestInit) => Promise<Response>;

/**
 * An HTTPS call that always checks the server's certificate (ruling 905). `--dev-certs` layers
 * `infra/docker-compose.staging-certs.yml`, which sets `NODE_TLS_REJECT_UNAUTHORIZED=0` on the
 * worker so that its calls to its own staging-certificate hosts work. That variable only sets the
 * DEFAULT of `rejectUnauthorized`: given explicitly, `true` wins (the ops skill's `door.mjs` relies
 * on the same rule). The global `fetch` follows the variable, so the start token and the ping went
 * out unchecked. Answers status only: neither caller reads a body.
 */
export function verifiedFetch(request: typeof https.request = https.request): HttpCall {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      if (target.protocol !== 'https:') {
        reject(new Error('verifiedFetch calls https URLs only'));
        return;
      }
      const options: https.RequestOptions = {
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string> | undefined,
        rejectUnauthorized: true,
      };
      if (init.signal) options.signal = init.signal;
      const req = request(target, options, (res) => {
        res.on('error', reject);
        res.on('end', () => resolve(new Response(null, { status: res.statusCode ?? 500 })));
        res.resume();
      });
      req.on('error', reject);
      req.end(typeof init.body === 'string' ? init.body : undefined);
    });
}
