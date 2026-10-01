/**
 * Whose X-Forwarded-For the API believes (ruling 195). The API sits behind Traefik on a private
 * Docker network. Léa's phone calls through Traefik: the API must see Léa's address, not
 * Traefik's, or every visitor shares one rate-limit bucket. Mallory adds her own X-Forwarded-For
 * to look like someone else: Traefik's entry comes last, so hers is ignored. A caller that reaches
 * the API from a public address, past Traefik, is never believed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trustOneLocalProxy } from './trust-proxy';

describe('trustOneLocalProxy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.18.0.3',
    '172.31.255.254',
    '192.168.1.10',
    '::1',
    'fd00::3',
    // A dual-stack listener hands an IPv4 peer in its mapped form.
    '::ffff:172.18.0.3',
  ])('believes the direct caller at the local address %s', (address) => {
    expect(trustOneLocalProxy(address, 0)).toBe(true);
  });

  it.each([
    '203.0.113.7',
    '2001:db8::1',
    '::ffff:203.0.113.7',
    // Just outside each private range.
    '172.15.255.255',
    '172.32.0.1',
    '11.0.0.1',
    // Not listed on purpose: carrier NAT and link-local. A proxy there would need its range added.
    '100.64.0.1',
    '169.254.10.1',
    'fe80::1',
  ])('does not believe the direct caller at %s, which is not a local address', (address) => {
    expect(trustOneLocalProxy(address, 0)).toBe(false);
  });

  it('believes one hop only: a second local address in the chain is a client', () => {
    expect(trustOneLocalProxy('192.168.1.10', 1)).toBe(false);
  });

  it.each(['', 'unknown', '999.1.1.1'])('does not believe the non-address "%s"', (address) => {
    expect(trustOneLocalProxy(address, 0)).toBe(false);
  });

  it('does not believe a closed socket, which has no address', () => {
    expect(trustOneLocalProxy(undefined, 0)).toBe(false);
  });
});

describe('req.ip behind one local proxy', () => {
  const app = fastify({ trustProxy: trustOneLocalProxy });
  app.get('/ip', (req) => req.ip);

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  async function ipSeen(remoteAddress: string, forwardedFor?: string): Promise<string> {
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });
    return res.body;
  }

  it("is the visitor's address as Traefik saw it", async () => {
    expect(await ipSeen('172.18.0.3', '198.51.100.20')).toBe('198.51.100.20');
  });

  it("ignores the address a client put in the header: Traefik's entry is the last", async () => {
    expect(await ipSeen('172.18.0.3', '9.9.9.9, 198.51.100.20')).toBe('198.51.100.20');
  });

  it('keeps a visitor on the venue network in their own bucket, whatever they claim', async () => {
    expect(await ipSeen('172.18.0.3', '9.9.9.9, 192.168.1.50')).toBe('192.168.1.50');
  });

  it('is the caller itself when it calls from a public address, header or not', async () => {
    expect(await ipSeen('203.0.113.7', '198.51.100.20')).toBe('203.0.113.7');
  });

  it('is the direct caller when no proxy header came', async () => {
    expect(await ipSeen('172.18.0.9')).toBe('172.18.0.9');
  });
});

describe('the API server', () => {
  it('is built with this trust, not a hop count (fastify 5.12 reads a number as "trust no one")', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(main).toMatch(/^\s*trustProxy: trustOneLocalProxy,$/m);
  });
});
