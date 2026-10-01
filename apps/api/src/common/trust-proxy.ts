import { BlockList, isIP } from 'node:net';

/** Loopback and the private ranges: where the proxy in front of the API lives (Docker, localhost). */
const LOCAL = new BlockList();
LOCAL.addSubnet('127.0.0.0', 8);
LOCAL.addSubnet('10.0.0.0', 8);
LOCAL.addSubnet('172.16.0.0', 12);
LOCAL.addSubnet('192.168.0.0', 16);
LOCAL.addAddress('::1', 'ipv6');
LOCAL.addSubnet('fc00::', 7, 'ipv6');

/**
 * Fastify's `trustProxy` (ruling 195): whose X-Forwarded-For the API believes. One hop, the direct
 * caller, and only when it calls from a local address. Traefik is the only proxy in front of the
 * API, so `req.ip` is then the last X-Forwarded-For entry: the address Traefik itself saw. Whatever
 * X-Forwarded-For a client sends, Traefik's own entry is the last, so the client cannot displace
 * it; and a caller from any other address is its own `req.ip`, whatever header it sends. Without
 * this, `req.ip` is Traefik's container address and every client shares one rate-limit bucket.
 *
 * A bare hop count (`trustProxy: 1`) no longer does this: fastify 5.12 takes it and trusts no one,
 * in silence, because a count never checked who the hop was. A proxy on a range that is not listed
 * above fails the same way.
 * A closed socket has no address: not believed (the range check would throw on it).
 */
export function trustOneLocalProxy(address: string | undefined, hop: number): boolean {
  if (hop !== 0 || !address) return false;
  return LOCAL.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}
