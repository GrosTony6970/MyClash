/**
 * Realtime, reachable AS app.${domain} — not merely up. Run by
 * scripts/check-edge-tls.mjs after a deploy.
 *
 * supabase/realtime is multi-tenant and resolves the tenant from the first
 * label of the Host header. Traefik forwards the client's Host untouched, so
 * this only works while SELF_HOST_TENANT_NAME matches that label. When it did
 * not, every websocket handshake 403'd and every live public surface silently
 * fell back to polling — for months. Nothing caught it: the container's own
 * healthcheck then addressed the tenant by PATH (/api/tenants/:id/health) and
 * answered 200 throughout. It now asks /api/ping by Host too (ruling 504), but
 * from inside the container, so it cannot see the edge's Host.
 *
 * /api/ping is the cheapest route that resolves the tenant the way the socket
 * does. A misconfigured tenant answers 401 {"message":"Tenant not found in
 * database"}. It reads no token, and the edge adds none, so both probes send
 * none: they used to wait for the anon key and were skipped without it.
 *
 * `send` is edge-probe.mjs's `request`; a test passes its own.
 *
 * @returns {Promise<string[]>} the errors, empty when both probes pass.
 */
export async function realtimeEdgeErrors(domain, send) {
  const errors = [];
  const probe = (path) =>
    send({
      protocol: 'https:',
      host: `app.${domain}`,
      path,
      method: 'GET',
      timeoutMs: 10_000,
      // check-edge-tls.mjs asserts each host's certificate trust on its own.
      rejectUnauthorized: false,
    });

  const ping = await probe('/realtime/v1/api/ping');
  if (ping.statusCode !== 200) {
    errors.push(
      `https://app.${domain}/realtime/v1/api/ping returned ${ping.statusCode ?? 'no response'} ` +
        `(expected 200). 401 = realtime cannot resolve a tenant named "app" — check ` +
        `SELF_HOST_TENANT_NAME against the Host Traefik forwards; websockets are dead.`,
    );
  }
  // Realtime's other /api routes are its tenant management, which took the anon key until
  // ruling 424 gave it its own secret: the edge must not forward them either way (ruling 420),
  // whatever label form a change gives the route.
  const tenants = await probe('/realtime/v1/api/tenants');
  if (tenants.statusCode !== 404) {
    errors.push(
      `https://app.${domain}/realtime/v1/api/tenants returned ${tenants.statusCode ?? 'no response'} ` +
        '(expected 404): the edge forwards Realtime tenant management, which takes any token ' +
        'signed with its API secret (rulings 420, 424).',
    );
  }
  return errors;
}
